#include "AircastCamera.h"
#include "AircastCar.h"
#include "AircastDrone.h"
#include "AircastEncoder.h"
#include "AircastPlayer.h"
#include "AircastScenario.h"

#include <csignal>
#include <cstdio>

#include "Camera/CameraComponent.h"
#include "Cesium3DTileset.h"
#include "CesiumCamera.h"
#include "CesiumCameraManager.h"
#include "CesiumGeoreference.h"
#include "CesiumGlobeAnchorComponent.h"
#include "CesiumSampleHeightResult.h"
#include "CesiumSunSky.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Dom/JsonObject.h"
#include "Engine/GameViewportClient.h"
#include "Engine/TextureRenderTarget2D.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/WorldSettings.h"
#include "IWebSocket.h"
#include "HAL/IConsoleManager.h"
#include "HAL/FileManager.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "TextureResource.h"
#include "TimerManager.h"
#include "WebSocketsModule.h"

namespace
{
	constexpr int64 GooglePhotorealisticAsset = 2275207;
	const FVector HomePose(149.1652373, -35.363262, 590.0);
	constexpr double GimbalTiltDegrees = -15.0;
	constexpr int32 FpvGimbal = 1;
	constexpr double SnapDegrees = 0.01;
	constexpr double RehomeDegrees = 0.1;
	constexpr double GroundClearance = 0.5;
	constexpr double LerpPerFrameAt60 = 0.2;
	constexpr double MaxPredictSeconds = 0.5;
	constexpr double CorrectionPerFrameAt60 = 0.06;

	double PerFrame(double AtSixty, double DeltaSeconds)
	{
		return 1.0 - FMath::Pow(1.0 - AtSixty, DeltaSeconds * 60.0);
	}
	constexpr double HomeHeightEaseMs = 0.5;
	constexpr double MinLabelPixels = 3.0;
	constexpr double WarmUpSeconds = 45.0;
	const TCHAR* DatasetBitrate = TEXT("4M");
	constexpr double MaxTurnRate = 1.0;
	constexpr double TurnRateSmoothing = 0.2;
	constexpr float PreviewScreenPercentage = 67.0f;
	constexpr float PreviewFrameRate = 60.0f;
	constexpr double EarthRadius = 6371000.0;
	constexpr double PlayerStartAltitudeM = 150.0;
	constexpr double PlayerCameraTiltDegrees = 25.0;

	FVector2D Advance(const FVector2D& LongitudeLatitude, const FVector& NorthEastUp)
	{
		return FVector2D(
			LongitudeLatitude.X + FMath::RadiansToDegrees(NorthEastUp.Y / (EarthRadius * FMath::Cos(FMath::DegreesToRadians(LongitudeLatitude.Y)))),
			LongitudeLatitude.Y + FMath::RadiansToDegrees(NorthEastUp.X / EarthRadius));
	}
	constexpr double ResampleSeconds = 1.0;
	constexpr double ReconnectSeconds = 2.0;
	constexpr int32 FrameRate = 30;
	const FIntPoint OutputSize(1280, 720);
	constexpr int32 Supersample = 1;
	const FIntPoint FrameSize = OutputSize * Supersample;
	constexpr float FieldOfView = 60.0f;
	constexpr double TargetFrameShare = 0.15;
	constexpr double NarrowestFieldOfView = 2.5;
	constexpr double ScreenSpaceError = 4.0;
	constexpr float SunnyIso = 200.0f;
	constexpr float HazeDistanceScale = 2.0f;
	constexpr float CloudBaseKm = 1.2f;
	constexpr float CloudDepthKm = 3.0f;
	const TCHAR* CloudMaterial = TEXT("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst.m_SimpleVolumetricCloud_Inst");
	constexpr float MotionBlur = 0.1f;
	constexpr float MotionBlurMaxPercent = 2.0f;
	constexpr float FilmGrain = 0.12f;
	constexpr float ColorFringe = 0.6f;
	constexpr float Vignette = 0.35f;
	constexpr float Bloom = 0.45f;
	constexpr int64 TileCacheBytes = 6144LL * 1024 * 1024;
	constexpr int32 TileLoadsInFlight = 48;
	constexpr double Gravity = 9.81;
	constexpr double SlowestFlight = 0.1;
}

AAircastCamera::AAircastCamera()
{
	PrimaryActorTick.bCanEverTick = true;
	GlobeAnchor = CreateDefaultSubobject<UCesiumGlobeAnchorComponent>(TEXT("GlobeAnchor"));
	GetCameraComponent()->SetFieldOfView(FieldOfView);
	GetCameraComponent()->SetConstraintAspectRatio(false);
	Capture = CreateDefaultSubobject<USceneCaptureComponent2D>(TEXT("Capture"));
	Capture->SetupAttachment(GetCameraComponent());
	Capture->FOVAngle = FieldOfView;
	Capture->CaptureSource = SCS_FinalColorLDR;
	Capture->bCaptureEveryFrame = false;
	Capture->bCaptureOnMovement = false;
	Capture->bAlwaysPersistRenderingState = true;
	Capture->PostProcessSettings = Look();
	GetCameraComponent()->PostProcessSettings = Look();
	GetCameraComponent()->PostProcessBlendWeight = 1.0f;
	Pose = HomePose;
	Pitch = FMath::DegreesToRadians(GimbalTiltDegrees);
}

FPostProcessSettings AAircastCamera::Look()
{
	FPostProcessSettings Exposure;
	Exposure.bOverride_AutoExposureMethod = true;
	Exposure.AutoExposureMethod = AEM_Manual;
	Exposure.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
	Exposure.AutoExposureApplyPhysicalCameraExposure = true;
	Exposure.bOverride_CameraISO = true;
	Exposure.CameraISO = SunnyIso;
	Exposure.bOverride_CameraShutterSpeed = true;
	Exposure.CameraShutterSpeed = 100.0f;
	Exposure.bOverride_DepthOfFieldFstop = true;
	Exposure.DepthOfFieldFstop = 16.0f;
	Exposure.bOverride_MotionBlurAmount = true;
	Exposure.MotionBlurAmount = MotionBlur;
	Exposure.bOverride_MotionBlurMax = true;
	Exposure.MotionBlurMax = MotionBlurMaxPercent;
	Exposure.bOverride_FilmGrainIntensity = true;
	Exposure.FilmGrainIntensity = FilmGrain;
	Exposure.bOverride_SceneFringeIntensity = true;
	Exposure.SceneFringeIntensity = ColorFringe;
	Exposure.bOverride_VignetteIntensity = true;
	Exposure.VignetteIntensity = Vignette;
	Exposure.bOverride_BloomIntensity = true;
	Exposure.BloomIntensity = Bloom;
	return Exposure;
}

void AAircastCamera::BeginPlay()
{
	Super::BeginPlay();
	std::signal(SIGPIPE, SIG_IGN);

	const TCHAR* CommandLine = FCommandLine::Get();
	FParse::Value(CommandLine, TEXT("Telemetry="), TelemetryUrl);
	FParse::Value(CommandLine, TEXT("Rtsp="), RtspUrl);
	FParse::Value(CommandLine, TEXT("Record="), DatasetDir);
	double Tilt = 0.0;
	FpvTilt = FParse::Value(CommandLine, TEXT("FpvTilt="), Tilt) ? TOptional<double>(FMath::DegreesToRadians(Tilt)) : TOptional<double>();
	PrepareDataset();
	FString IonToken;
	FParse::Value(CommandLine, TEXT("IonToken="), IonToken);

	GetWorld()->GetWorldSettings()->bEnableWorldBoundsChecks = false;
	Frame = NewObject<UTextureRenderTarget2D>(this);
	Frame->InitCustomFormat(FrameSize.X, FrameSize.Y, PF_B8G8R8A8, true);
	Capture->TextureTarget = Frame;
	const bool bPreview = FParse::Param(CommandLine, TEXT("Preview"));
	FString Aimed;
	bAimAtTarget = FParse::Value(CommandLine, TEXT("Aim="), Aimed) && Aimed == TEXT("target");
	if (UGameViewportClient* Viewport = GetWorld()->GetGameViewport())
	{
		Viewport->bDisableWorldRendering = !RtspUrl.IsEmpty() && !bPreview;
	}
	if (bPreview)
	{
		IConsoleManager::Get().FindConsoleVariable(TEXT("r.ScreenPercentage"))->Set(PreviewScreenPercentage);
		IConsoleManager::Get().FindConsoleVariable(TEXT("t.MaxFPS"))->Set(PreviewFrameRate);
	}

	ACesiumGeoreference::GetDefaultGeoreference(this)->SetOriginLongitudeLatitudeHeight(HomePose);

	Tileset = GetWorld()->SpawnActor<ACesium3DTileset>();
	Tileset->ForbidHoles = true;
	Tileset->MaximumCachedBytes = TileCacheBytes;
	Tileset->MaximumSimultaneousTileLoads = TileLoadsInFlight;
	Tileset->PreloadAncestors = false;
	Tileset->PreloadSiblings = false;
	Tileset->SetTilesetSource(ETilesetSource::FromCesiumIon);
	Tileset->SetIonAccessToken(IonToken);
	Tileset->SetIonAssetID(GooglePhotorealisticAsset);
	Tileset->SetMaximumScreenSpaceError(ScreenSpaceError);

	Sky = GetWorld()->SpawnActor<ACesiumSunSky>();
	Sky->TimeZone = FMath::RoundToDouble(HomePose.X / 15.0);
	Sky->UseDaylightSavingTime = false;
	Sky->SolarTime = AircastScenario().SolarTime;
	Sky->UpdateSun();
	Sky->SkyAtmosphere->SetAerialPespectiveViewDistanceScale(HazeDistanceScale);

	UVolumetricCloudComponent* Clouds = GetWorld()->SpawnActor<AVolumetricCloud>()->FindComponentByClass<UVolumetricCloudComponent>();
	UMaterialInterface* CloudLook = LoadObject<UMaterialInterface>(nullptr, CloudMaterial);
	UMaterialInstanceDynamic* Coverage = UMaterialInstanceDynamic::Create(CloudLook, this);
	Coverage->SetScalarParameterValue(TEXT("Cloud_GlobalCoverage"), AircastScenario().CloudCover);
	Clouds->SetMaterial(Coverage);
	Clouds->SetLayerBottomAltitude(CloudBaseKm);
	Clouds->SetLayerHeight(CloudDepthKm);


	Car = GetWorld()->SpawnActor<AAircastCar>();
	Drone = GetWorld()->SpawnActor<AAircastDrone>();
	Player = FParse::Param(CommandLine, TEXT("Play")) ? GetWorld()->SpawnActor<AAircastPlayer>() : nullptr;

	GetWorld()->GetFirstPlayerController()->SetViewTarget(this);
	Connect();
}

void AAircastCamera::EndPlay(const EEndPlayReason::Type Reason)
{
	GetWorldTimerManager().ClearTimer(Reconnect);
	if (Telemetry)
	{
		Telemetry->OnClosed().Clear();
		Telemetry->Close();
	}
	Encoder.Reset();
	Super::EndPlay(Reason);
}

void AAircastCamera::Connect()
{
	Telemetry = FWebSocketsModule::Get().CreateWebSocket(TelemetryUrl);
	const TWeakObjectPtr<AAircastCamera> Self(this);
	const auto RetryLater = [Self]()
	{
		if (Self.IsValid())
		{
			Self->GetWorldTimerManager().SetTimer(Self->Reconnect, Self.Get(), &AAircastCamera::Connect, ReconnectSeconds, false);
		}
	};
	Telemetry->OnMessage().AddLambda([Self](const FString& Message)
	{
		if (Self.IsValid())
		{
			Self->Receive(Message);
		}
	});
	Telemetry->OnConnected().AddLambda([Url = TelemetryUrl]() { UE_LOG(LogTemp, Display, TEXT("Telemetry connected to %s"), *Url); });
	Telemetry->OnConnectionError().AddLambda([RetryLater](const FString& Error)
	{
		UE_LOG(LogTemp, Warning, TEXT("Telemetry connection failed: %s"), *Error);
		RetryLater();
	});
	Telemetry->OnClosed().AddLambda([RetryLater](int32, const FString&, bool) { RetryLater(); });
	Telemetry->Connect();
}

void AAircastCamera::Receive(const FString& Message)
{
	TSharedPtr<FJsonObject> Json;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Message), Json) || !Json.IsValid())
	{
		return;
	}
	const FString Type = Json->GetStringField(TEXT("type"));
	if (Type == TEXT("ATTITUDE"))
	{
		Latest.Roll = Json->GetNumberField(TEXT("roll"));
		Latest.Pitch = Json->GetNumberField(TEXT("pitch"));
		Latest.Yaw = Json->GetNumberField(TEXT("yaw"));
	}
	else if (Type == TEXT("GLOBAL_POSITION_INT"))
	{
		Latest.LongitudeLatitude = FVector2D(Json->GetNumberField(TEXT("lng")), Json->GetNumberField(TEXT("lat")));
		Latest.RelativeAlt = Json->GetNumberField(TEXT("relative_alt"));
		Latest.Velocity = FVector(Json->GetNumberField(TEXT("vx")), Json->GetNumberField(TEXT("vy")), -Json->GetNumberField(TEXT("vz")));
		Latest.FixAt = FPlatformTime::Seconds();
		const bool bElsewhere = !Latest.Home.IsSet() || FVector2D::Distance(*Latest.Home, Latest.LongitudeLatitude) > RehomeDegrees;
		if (bElsewhere && !Latest.LongitudeLatitude.IsZero())
		{
			Rehome(Latest.LongitudeLatitude);
		}
	}
	else if (Type == TEXT("GIMBAL") && Json->GetIntegerField(TEXT("device")) == FpvGimbal)
	{
		Latest.Gimbal = FGimbal{Json->GetNumberField(TEXT("pitch")), Json->GetNumberField(TEXT("yaw")), Json->GetBoolField(TEXT("earth_yaw"))};
	}
	else if (Type == TEXT("CAR"))
	{
		Latest.Car = FCarFix{
			FVector2D(Json->GetNumberField(TEXT("lng")), Json->GetNumberField(TEXT("lat"))),
			FMath::DegreesToRadians(Json->GetNumberField(TEXT("hdg")))};
	}
	else if (Type == TEXT("TARGET"))
	{
		const double Now = FPlatformTime::Seconds();
		const double Heading = FMath::DegreesToRadians(Json->GetNumberField(TEXT("hdg")));
		const double Elapsed = Latest.Drone ? Now - Latest.Drone->At : 0.0;
		Latest.Drone = FDroneFix{
			FVector2D(Json->GetNumberField(TEXT("lng")), Json->GetNumberField(TEXT("lat"))),
			Json->GetNumberField(TEXT("relative_alt")),
			Heading,
			FMath::Sqrt(FMath::Square(Json->GetNumberField(TEXT("vx"))) + FMath::Square(Json->GetNumberField(TEXT("vy")))),
			-Json->GetNumberField(TEXT("vz")),
			FMath::Lerp(Latest.Drone ? Latest.Drone->TurnRate : 0.0,
				Elapsed > 0.0 ? FMath::Clamp(FMath::FindDeltaAngleRadians(Latest.Drone->Heading, Heading) / Elapsed, -MaxTurnRate, MaxTurnRate) : 0.0,
				TurnRateSmoothing),
			Now};
	}
}

void AAircastCamera::Rehome(const FVector2D& LongitudeLatitude)
{
	Latest.Home = LongitudeLatitude;
	ACesiumGeoreference::GetDefaultGeoreference(this)->SetOriginLongitudeLatitudeHeight(FVector(LongitudeLatitude.X, LongitudeLatitude.Y, HomePose.Z));
	Sky->TimeZone = FMath::RoundToDouble(LongitudeLatitude.X / 15.0);
	Sky->UpdateSun();
	Pose = FVector(LongitudeLatitude.X, LongitudeLatitude.Y, Pose.Z);
	HomeGround = FGroundSample();
	BelowGround = FGroundSample();
	HomeHeight.Reset();
}

void AAircastCamera::Sample(FGroundSample& Ground, const FVector2D& LongitudeLatitude)
{
	const double Now = FPlatformTime::Seconds();
	const bool bFresh = Ground.Height.IsSet() && Ground.LongitudeLatitude.Equals(LongitudeLatitude);
	if (Ground.bPending || Now < Ground.Due || bFresh)
	{
		return;
	}
	Ground.bPending = true;
	Ground.Due = Now + ResampleSeconds;
	Ground.LongitudeLatitude = LongitudeLatitude;
	const TWeakObjectPtr<AAircastCamera> Self(this);
	FGroundSample* Target = &Ground;
	Tileset->SampleHeightMostDetailed(
		{FVector(LongitudeLatitude.X, LongitudeLatitude.Y, 0.0)},
		FCesiumSampleHeightMostDetailedCallback::CreateLambda(
			[Self, Target](ACesium3DTileset*, const TArray<FCesiumSampleHeightResult>& Results, const TArray<FString>&)
			{
				if (!Self.IsValid())
				{
					return;
				}
				Target->bPending = false;
				if (Results.Num() == 1 && Results[0].SampleSuccess)
				{
					Target->Height = Results[0].LongitudeLatitudeHeight.Z;
				}
			}));
}

void AAircastCamera::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const double Alpha = PerFrame(LerpPerFrameAt60, DeltaSeconds);
	const double Correction = PerFrame(CorrectionPerFrameAt60, DeltaSeconds);
	Sample(HomeGround, Latest.Home.Get(FVector2D(HomePose.X, HomePose.Y)));
	HomeHeight = !HomeGround.Height ? HomeHeight
		: !HomeHeight ? HomeGround.Height
		: TOptional<double>(*HomeHeight + FMath::Clamp(*HomeGround.Height - *HomeHeight, -HomeHeightEaseMs * DeltaSeconds, HomeHeightEaseMs * DeltaSeconds));
	const FQuat WasAimed = GetActorQuat();
	if (Player)
	{
		FlyPlayer();
	}
	else
	{
		FollowTelemetry(Alpha, Correction, DeltaSeconds);
	}
	const bool bTracking = bAimAtTarget && Drone && !Drone->IsHidden();
	if (bTracking)
	{
		const FVector Sight = Drone->GetActorLocation() - GetActorLocation();
		SetActorRotation(FQuat::Slerp(WasAimed, Sight.Rotation().Quaternion(), Alpha));
		const double Framed = FMath::RadiansToDegrees(2.0 * FMath::Atan(AircastScenario().Target.LengthCm / (2.0 * TargetFrameShare * FMath::Max(Sight.Size(), 1.0))));
		Zoom = FMath::Lerp(Zoom > 0.0 ? Zoom : FieldOfView, FMath::Clamp(Framed, NarrowestFieldOfView, static_cast<double>(FieldOfView)), Alpha);
	}
	const float Lens = bTracking ? static_cast<float>(Zoom) : FieldOfView;
	GetCameraComponent()->SetFieldOfView(Lens);
	Capture->FOVAngle = Lens;
	const FCesiumCamera Seen(FVector2D(OutputSize), GetActorLocation(), GetActorRotation(), Lens);
	ACesiumCameraManager* TileViews = ACesiumCameraManager::GetDefaultCameraManager(this);
	TileView = TileView == INDEX_NONE ? TileViews->AddCamera(Seen) : TileView;
	TileViews->UpdateCamera(TileView, Seen);
	DriveCar(Alpha);
	DriveDrone(Alpha, Correction, DeltaSeconds);
	Stream();
}

void AAircastCamera::DriveCar(double Alpha)
{
	if (!Latest.Car)
	{
		return;
	}
	const FVector2D Was(CarPose.X, CarPose.Y);
	const bool bJumped = FVector2D::Distance(Was, Latest.Car->LongitudeLatitude) > SnapDegrees;
	const FVector2D At = bJumped ? Latest.Car->LongitudeLatitude : FMath::Lerp(Was, Latest.Car->LongitudeLatitude, Alpha);
	CarHeading = bJumped ? Latest.Car->Heading : CarHeading + FMath::FindDeltaAngleRadians(CarHeading, Latest.Car->Heading) * Alpha;
	Sample(CarGround, At);
	if (!CarGround.Height)
	{
		return;
	}
	CarPose = FVector(At.X, At.Y, bJumped || CarPose.Z == 0.0 ? *CarGround.Height : FMath::Lerp(CarPose.Z, *CarGround.Height, Alpha));
	Car->Drive(CarPose, CarHeading);
}

void AAircastCamera::FlyPlayer()
{
	ACesiumGeoreference* Globe = ACesiumGeoreference::GetDefaultGeoreference(this);
	if (!Player->IsFlying() && HomeHeight && Latest.Home)
	{
		Player->Launch(Globe->TransformLongitudeLatitudeHeightPositionToUnreal(FVector(Latest.Home->X, Latest.Home->Y, *HomeHeight + PlayerStartAltitudeM)));
	}
	if (!Player->IsFlying())
	{
		return;
	}
	Pose = Globe->TransformUnrealPositionToLongitudeLatitudeHeight(Player->GetActorLocation());
	Sample(BelowGround, FVector2D(Pose.X, Pose.Y));
	const TOptional<double> GroundZ = BelowGround.Height
		? TOptional<double>(Globe->TransformLongitudeLatitudeHeightPositionToUnreal(FVector(Pose.X, Pose.Y, *BelowGround.Height)).Z)
		: TOptional<double>();
	Player->Judge(Drone && !Drone->IsHidden() ? TOptional<FVector>(Drone->GetActorLocation()) : TOptional<FVector>(), GroundZ);
	const double Tilt = FpvTilt ? FMath::RadiansToDegrees(*FpvTilt) : PlayerCameraTiltDegrees;
	SetActorLocationAndRotation(Player->GetActorLocation(), Player->GetActorQuat() * FRotator(Tilt, 0.0, 0.0).Quaternion());
}

void AAircastCamera::FollowTelemetry(double Alpha, double Correction, double DeltaSeconds)
{
	const FVector2D Current(Pose.X, Pose.Y);
	const double Ahead = FMath::Min(FPlatformTime::Seconds() - Latest.FixAt, MaxPredictSeconds);
	const FVector2D Predicted = Advance(Latest.LongitudeLatitude, Latest.Velocity * Ahead);
	const bool bTeleported = FVector2D::Distance(Current, Predicted) > SnapDegrees;
	const FVector2D LongitudeLatitude = Latest.LongitudeLatitude.IsZero() ? Current
		: bTeleported ? Predicted
		: FMath::Lerp(Advance(Current, Latest.Velocity * DeltaSeconds), Predicted, Correction);

	Sample(BelowGround, LongitudeLatitude);
	const double Height = HomeHeight.IsSet() && BelowGround.Height.IsSet()
		? FMath::Lerp(Pose.Z + Latest.Velocity.Z * DeltaSeconds, FMath::Max(*HomeHeight + Latest.RelativeAlt + Latest.Velocity.Z * Ahead, *BelowGround.Height) + GroundClearance, Correction)
		: Pose.Z;

	Pose = FVector(LongitudeLatitude.X, LongitudeLatitude.Y, Height);
	const TOptional<FGimbal>& Gimbal = FpvTilt ? TOptional<FGimbal>() : Latest.Gimbal;
	const double Pan = !Gimbal ? 0.0 : Gimbal->bEarthYaw ? Gimbal->Yaw - Latest.Yaw : Gimbal->Yaw;
	const double AimPitch = FpvTilt ? Latest.Pitch + *FpvTilt : Gimbal ? Gimbal->Pitch : FMath::DegreesToRadians(GimbalTiltDegrees);
	const double AimRoll = FpvTilt ? Latest.Roll : Latest.Roll * FMath::Cos(Pan) + Latest.Pitch * FMath::Sin(Pan);
	Heading += FMath::FindDeltaAngleRadians(Heading, Latest.Yaw + Pan) * Alpha;
	Pitch = FMath::Lerp(Pitch, AimPitch, Alpha);
	Roll = FMath::Lerp(Roll, AimRoll, Alpha);
	GlobeAnchor->MoveToLongitudeLatitudeHeight(Pose);
	GlobeAnchor->SetEastSouthUpRotation(
		FRotator(FMath::RadiansToDegrees(Pitch), FMath::RadiansToDegrees(Heading) - 90.0, FMath::RadiansToDegrees(Roll)).Quaternion());
}

void AAircastCamera::DriveDrone(double Alpha, double Correction, double DeltaSeconds)
{
	if (!Latest.Drone || !HomeHeight)
	{
		return;
	}
	const FDroneFix& Fix = *Latest.Drone;
	const double Ahead = FMath::Min(FPlatformTime::Seconds() - Fix.At, MaxPredictSeconds);
	const FVector Ground(Fix.Speed * FMath::Cos(Fix.Heading), Fix.Speed * FMath::Sin(Fix.Heading), 0.0);
	const FVector2D Predicted = Advance(Fix.LongitudeLatitude, Ground * Ahead);
	const FVector Goal(Predicted.X, Predicted.Y, *HomeHeight + Fix.RelativeAlt + Fix.Climb * Ahead);
	const bool bJumped = DronePose.IsZero() || FVector2D::Distance(FVector2D(DronePose.X, DronePose.Y), Fix.LongitudeLatitude) > SnapDegrees;
	const FVector2D Coasted = Advance(FVector2D(DronePose.X, DronePose.Y), Ground * DeltaSeconds);
	DronePose = bJumped ? Goal : FMath::Lerp(FVector(Coasted.X, Coasted.Y, DronePose.Z + Fix.Climb * DeltaSeconds), Goal, Correction);
	DroneHeading = bJumped ? Fix.Heading : DroneHeading + FMath::FindDeltaAngleRadians(DroneHeading, Fix.Heading) * Alpha;
	DronePitch = FMath::Lerp(DronePitch, FMath::Atan2(Fix.Climb, FMath::Max(Fix.Speed, SlowestFlight)), Alpha);
	DroneRoll = FMath::Lerp(DroneRoll, FMath::Atan(Fix.Speed * Fix.TurnRate / Gravity), Alpha);
	Drone->Fly(DronePose, DroneHeading, DronePitch, DroneRoll);
}

void AAircastCamera::Stream()
{
	if (RtspUrl.IsEmpty() && DatasetDir.IsEmpty())
	{
		return;
	}
	Capture->CaptureScene();
	const double Now = FPlatformTime::Seconds();
	if (Now < NextFrameAt)
	{
		return;
	}
	NextFrameAt = FMath::Max(NextFrameAt + 1.0 / FrameRate, Now - 1.0 / FrameRate);
	if (!Encoder)
	{
		const FString Command = RtspUrl.IsEmpty() ? FString() : FString::Printf(
			TEXT("ffmpeg -loglevel error -use_wallclock_as_timestamps 1 -f rawvideo -pix_fmt bgra -s %dx%d -i - ")
			TEXT("-vf scale=%d:%d:flags=lanczos -r %d -c:v h264_videotoolbox -realtime 1 -b:v 4M -g %d -bf 0 -f rtsp -rtsp_transport tcp %s"),
			FrameSize.X, FrameSize.Y, OutputSize.X, OutputSize.Y, FrameRate, FrameRate, *RtspUrl);
		const FString DatasetCommand = DatasetDir.IsEmpty() ? FString() : FString::Printf(
			TEXT("ffmpeg -loglevel error -y -f rawvideo -pix_fmt bgra -s %dx%d -r %d -i - -fps_mode passthrough ")
			TEXT("-c:v h264_videotoolbox -b:v %s -g %d -bf 0 -movflags +frag_keyframe+empty_moov \"%s\""),
			FrameSize.X, FrameSize.Y, FrameRate, DatasetBitrate, FrameRate, *FPaths::Combine(DatasetDir, TEXT("video.mp4")));
		Encoder = MakeUnique<FAircastEncoder>(Command, FrameSize, DatasetDir, DatasetCommand);
	}
	if (FTextureRenderTargetResource* Resource = Frame->GameThread_GetRenderTargetResource())
	{
		const bool bRecord = !DatasetDir.IsEmpty() && GetWorld()->GetTimeSeconds() >= WarmUpSeconds;
		Encoder->Submit(Resource, bRecord ? TOptional<FString>(Label()) : TOptional<FString>());
	}
}

void AAircastCamera::PrepareDataset() const
{
	if (DatasetDir.IsEmpty())
	{
		return;
	}
	IFileManager::Get().MakeDirectory(*FPaths::Combine(DatasetDir, TEXT("images")), true);
	IFileManager::Get().MakeDirectory(*FPaths::Combine(DatasetDir, TEXT("labels")), true);
	FFileHelper::SaveStringToFile(
		FString::Printf(TEXT("path: %s\ntrain: images\nval: images\nnames: [%s]\n"), *FPaths::ConvertRelativePathToFull(DatasetDir),
			*FString::JoinBy(AircastTargets(), TEXT(", "), &FAircastTarget::Name)),
		*FPaths::Combine(DatasetDir, TEXT("data.yaml")));
	FFileHelper::SaveStringToFile(AircastScenario().Describe(), *FPaths::Combine(DatasetDir, TEXT("scenario.json")));
}

FString AAircastCamera::Label() const
{
	if (!Drone || Drone->IsHidden())
	{
		return FString();
	}
	FMinimalViewInfo View;
	Capture->GetCameraView(0.0f, View);
	View.AspectRatio = static_cast<float>(FrameSize.X) / FrameSize.Y;
	View.bConstrainAspectRatio = true;
	FMatrix ViewMatrix, Projection, ViewProjection;
	UGameplayStatics::CalculateViewProjectionMatricesFromMinimalView(View, TOptional<FMatrix>(), ViewMatrix, Projection, ViewProjection);
	FBox2D Box(ForceInit);
	for (const FVector& Point : Drone->Silhouette())
	{
		const FPlane Clip = ViewProjection.TransformFVector4(FVector4(Point, 1.0));
		if (Clip.W > 0.0)
		{
			Box += FVector2D((Clip.X / Clip.W + 1.0) * 0.5, (1.0 - Clip.Y / Clip.W) * 0.5);
		}
	}
	const FBox2D Seen = Box.bIsValid ? Box.Overlap(FBox2D(FVector2D::ZeroVector, FVector2D::UnitVector)) : Box;
	if (!Seen.bIsValid || Seen.GetSize().X * FrameSize.X < MinLabelPixels || Seen.GetSize().Y * FrameSize.Y < MinLabelPixels)
	{
		return FString();
	}
	FHitResult Hit;
	FCollisionQueryParams Query;
	Query.AddIgnoredActor(Drone);
	if (GetWorld()->LineTraceSingleByChannel(Hit, View.Location, Drone->GetActorLocation(), ECC_Visibility, Query))
	{
		return FString();
	}
	return FString::Printf(TEXT("%d %.6f %.6f %.6f %.6f\n"), AircastScenario().Class, Seen.GetCenter().X, Seen.GetCenter().Y, Seen.GetSize().X, Seen.GetSize().Y);
}
