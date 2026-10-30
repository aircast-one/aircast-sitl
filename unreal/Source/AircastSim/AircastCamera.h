#pragma once

#include "AircastEncoder.h"
#include "Camera/CameraActor.h"
#include "AircastCamera.generated.h"

class IWebSocket;
class AAircastCar;
class AAircastDrone;
class AAircastPlayer;
class ACesium3DTileset;
class ACesiumSunSky;
class UCesiumGlobeAnchorComponent;
class USceneCaptureComponent2D;
class UTextureRenderTarget2D;

UCLASS()
class AAircastCamera : public ACameraActor
{
	GENERATED_BODY()

public:
	AAircastCamera();
	static FPostProcessSettings Look();
	virtual void Tick(float DeltaSeconds) override;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

private:
	struct FGimbal
	{
		double Pitch = 0.0;
		double Yaw = 0.0;
		bool bEarthYaw = false;
	};

	struct FCarFix
	{
		FVector2D LongitudeLatitude = FVector2D::ZeroVector;
		double Heading = 0.0;
	};

	struct FDroneFix
	{
		FVector2D LongitudeLatitude = FVector2D::ZeroVector;
		double RelativeAlt = 0.0;
		double Heading = 0.0;
		double Speed = 0.0;
		double Climb = 0.0;
		double TurnRate = 0.0;
		double At = 0.0;
	};

	struct FTelemetry
	{
		FVector2D LongitudeLatitude = FVector2D::ZeroVector;
		double RelativeAlt = 0.0;
		FVector Velocity = FVector::ZeroVector;
		double FixAt = 0.0;
		double Roll = 0.0;
		double Pitch = 0.0;
		double Yaw = 0.0;
		TOptional<FVector2D> Home;
		TOptional<FGimbal> Gimbal;
		TOptional<FCarFix> Car;
		TOptional<FDroneFix> Drone;
	};

	struct FGroundSample
	{
		FVector2D LongitudeLatitude = FVector2D::ZeroVector;
		TOptional<double> Height;
		double Due = 0.0;
		bool bPending = false;
	};

	void Connect();
	void Receive(const FString& Message);
	void Rehome(const FVector2D& LongitudeLatitude);
	void Sample(FGroundSample& Ground, const FVector2D& LongitudeLatitude);
	void Stream();
	FString Label() const;
	void PrepareDataset() const;
	void DriveCar(double Alpha);
	void DriveDrone(double Alpha, double Correction, double DeltaSeconds);
	void FollowTelemetry(double Alpha, double Correction, double DeltaSeconds);
	void FlyPlayer();

	UPROPERTY()
	TObjectPtr<UCesiumGlobeAnchorComponent> GlobeAnchor;

	UPROPERTY()
	TObjectPtr<USceneCaptureComponent2D> Capture;

	UPROPERTY()
	TObjectPtr<UTextureRenderTarget2D> Frame;

	UPROPERTY()
	TObjectPtr<ACesium3DTileset> Tileset;

	UPROPERTY()
	TObjectPtr<ACesiumSunSky> Sky;

	UPROPERTY()
	TObjectPtr<AAircastCar> Car;

	UPROPERTY()
	TObjectPtr<AAircastDrone> Drone;

	UPROPERTY()
	TObjectPtr<AAircastPlayer> Player;

	TSharedPtr<IWebSocket> Telemetry;
	FTimerHandle Reconnect;
	FString TelemetryUrl = TEXT("ws://127.0.0.1:8889");
	FString RtspUrl;
	FString DatasetDir;
	TOptional<double> FpvTilt;
	bool bAimAtTarget = false;
	double Zoom = 0.0;
	FTelemetry Latest;
	FVector Pose;
	double Heading = 0.0;
	double Pitch = 0.0;
	double Roll = 0.0;
	FVector CarPose = FVector::ZeroVector;
	double CarHeading = 0.0;
	FVector DronePose = FVector::ZeroVector;
	double DroneHeading = 0.0;
	double DronePitch = 0.0;
	double DroneRoll = 0.0;
	FGroundSample HomeGround;
	TOptional<double> HomeHeight;
	FGroundSample BelowGround;
	FGroundSample CarGround;
	TUniquePtr<FAircastEncoder> Encoder;
	double NextFrameAt = 0.0;
	int32 TileView = INDEX_NONE;
};
