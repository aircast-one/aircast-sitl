#include "AircastCamera.h"

#include <csignal>
#include <cstdio>

#include "Camera/CameraComponent.h"
#include "Cesium3DTileset.h"
#include "CesiumGeoreference.h"
#include "CesiumGlobeAnchorComponent.h"
#include "CesiumSampleHeightResult.h"
#include "CesiumSunSky.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Dom/JsonObject.h"
#include "Engine/GameViewportClient.h"
#include "Engine/TextureRenderTarget2D.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/WorldSettings.h"
#include "IWebSocket.h"
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
	constexpr double GroundClearance = 0.5;
	constexpr double LerpPerFrameAt60 = 0.1;
	constexpr double ResampleSeconds = 1.0;
	constexpr double ReconnectSeconds = 2.0;
	constexpr int32 FrameRate = 30;
	const FIntPoint OutputSize(1280, 720);
	constexpr int32 Supersample = 2;
	const FIntPoint FrameSize = OutputSize * Supersample;
	constexpr float FieldOfView = 60.0f;
	constexpr double ScreenSpaceError = 4.0;
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
	FPostProcessSettings& Exposure = Capture->PostProcessSettings;
	Exposure.bOverride_AutoExposureMethod = true;
	Exposure.AutoExposureMethod = AEM_Manual;
	Exposure.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
	Exposure.AutoExposureApplyPhysicalCameraExposure = true;
	Exposure.bOverride_CameraISO = true;
	Exposure.CameraISO = 100.0f;
	Exposure.bOverride_CameraShutterSpeed = true;
	Exposure.CameraShutterSpeed = 100.0f;
	Exposure.bOverride_DepthOfFieldFstop = true;
	Exposure.DepthOfFieldFstop = 16.0f;
	Pose = HomePose;
}

void AAircastCamera::BeginPlay()
{
	Super::BeginPlay();
	std::signal(SIGPIPE, SIG_IGN);

	const TCHAR* CommandLine = FCommandLine::Get();
	FParse::Value(CommandLine, TEXT("Telemetry="), TelemetryUrl);
	FParse::Value(CommandLine, TEXT("Rtsp="), RtspUrl);
	FString IonToken;
	FParse::Value(CommandLine, TEXT("IonToken="), IonToken);

	GetWorld()->GetWorldSettings()->bEnableWorldBoundsChecks = false;
	Frame = NewObject<UTextureRenderTarget2D>(this);
	Frame->InitCustomFormat(FrameSize.X, FrameSize.Y, PF_B8G8R8A8, true);
	Capture->TextureTarget = Frame;
	if (UGameViewportClient* Viewport = GetWorld()->GetGameViewport())
	{
		Viewport->bDisableWorldRendering = !RtspUrl.IsEmpty();
	}

	ACesiumGeoreference::GetDefaultGeoreference(this)->SetOriginLongitudeLatitudeHeight(HomePose);

	Tileset = GetWorld()->SpawnActor<ACesium3DTileset>();
	Tileset->SetTilesetSource(ETilesetSource::FromCesiumIon);
	Tileset->SetIonAccessToken(IonToken);
	Tileset->SetIonAssetID(GooglePhotorealisticAsset);
	Tileset->SetMaximumScreenSpaceError(ScreenSpaceError);

	ACesiumSunSky* Sky = GetWorld()->SpawnActor<ACesiumSunSky>();
	Sky->TimeZone = FMath::RoundToDouble(HomePose.X / 15.0);
	Sky->UseDaylightSavingTime = false;
	Sky->SolarTime = 12.0;
	Sky->UpdateSun();

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
	if (Encoder)
	{
		pclose(Encoder);
		Encoder = nullptr;
	}
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
		Latest.Yaw = Json->GetNumberField(TEXT("yaw"));
	}
	else if (Type == TEXT("GLOBAL_POSITION_INT"))
	{
		Latest.LongitudeLatitude = FVector2D(Json->GetNumberField(TEXT("lng")), Json->GetNumberField(TEXT("lat")));
		Latest.RelativeAlt = Json->GetNumberField(TEXT("relative_alt"));
		if (!Latest.Home.IsSet() && !Latest.LongitudeLatitude.IsZero())
		{
			Latest.Home = Latest.LongitudeLatitude;
		}
	}
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
	const double Alpha = 1.0 - FMath::Pow(1.0 - LerpPerFrameAt60, DeltaSeconds * 60.0);
	const FVector2D Current(Pose.X, Pose.Y);
	const FVector2D LongitudeLatitude = Latest.LongitudeLatitude.IsZero() ? Current : FMath::Lerp(Current, Latest.LongitudeLatitude, Alpha);

	Sample(HomeGround, Latest.Home.Get(FVector2D(HomePose.X, HomePose.Y)));
	Sample(BelowGround, LongitudeLatitude);
	const double Height = HomeGround.Height.IsSet() && BelowGround.Height.IsSet()
		? FMath::Lerp(Pose.Z, FMath::Max(*HomeGround.Height + Latest.RelativeAlt, *BelowGround.Height) + GroundClearance, Alpha)
		: Pose.Z;

	Pose = FVector(LongitudeLatitude.X, LongitudeLatitude.Y, Height);
	Heading += FMath::FindDeltaAngleRadians(Heading, Latest.Yaw) * Alpha;
	GlobeAnchor->MoveToLongitudeLatitudeHeight(Pose);
	GlobeAnchor->SetEastSouthUpRotation(FRotator(GimbalTiltDegrees, FMath::RadiansToDegrees(Heading) - 90.0, 0.0).Quaternion());
	Stream();
}

void AAircastCamera::Stream()
{
	if (RtspUrl.IsEmpty())
	{
		return;
	}
	if (!Encoder)
	{
		const FString Command = FString::Printf(
			TEXT("ffmpeg -loglevel error -use_wallclock_as_timestamps 1 -f rawvideo -pix_fmt bgra -s %dx%d -i - ")
			TEXT("-vf scale=%d:%d:flags=lanczos -r %d -c:v h264_videotoolbox -realtime 1 -b:v 4M -g %d -bf 0 -f rtsp -rtsp_transport tcp %s"),
			FrameSize.X, FrameSize.Y, OutputSize.X, OutputSize.Y, FrameRate, FrameRate, *RtspUrl);
		Encoder = popen(TCHAR_TO_UTF8(*Command), "w");
	}
	Capture->CaptureScene();
	TArray<FColor> Pixels;
	FTextureRenderTargetResource* Resource = Frame->GameThread_GetRenderTargetResource();
	if (Encoder && Resource && Resource->ReadPixels(Pixels) && Pixels.Num() == FrameSize.X * FrameSize.Y)
	{
		fwrite(Pixels.GetData(), sizeof(FColor), Pixels.Num(), Encoder);
	}
}
