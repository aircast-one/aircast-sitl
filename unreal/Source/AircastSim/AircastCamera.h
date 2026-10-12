#pragma once

#include "Camera/CameraActor.h"
#include "AircastCamera.generated.h"

class IWebSocket;
class ACesium3DTileset;
class UCesiumGlobeAnchorComponent;
class USceneCaptureComponent2D;
class UTextureRenderTarget2D;

UCLASS()
class AAircastCamera : public ACameraActor
{
	GENERATED_BODY()

public:
	AAircastCamera();
	virtual void Tick(float DeltaSeconds) override;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

private:
	struct FTelemetry
	{
		FVector2D LongitudeLatitude = FVector2D::ZeroVector;
		double RelativeAlt = 0.0;
		double Yaw = 0.0;
		TOptional<FVector2D> Home;
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
	void Sample(FGroundSample& Ground, const FVector2D& LongitudeLatitude);
	void Stream();

	UPROPERTY()
	TObjectPtr<UCesiumGlobeAnchorComponent> GlobeAnchor;

	UPROPERTY()
	TObjectPtr<USceneCaptureComponent2D> Capture;

	UPROPERTY()
	TObjectPtr<UTextureRenderTarget2D> Frame;

	UPROPERTY()
	TObjectPtr<ACesium3DTileset> Tileset;

	TSharedPtr<IWebSocket> Telemetry;
	FTimerHandle Reconnect;
	FString TelemetryUrl = TEXT("ws://127.0.0.1:8889");
	FString RtspUrl;
	FTelemetry Latest;
	FVector Pose;
	double Heading = 0.0;
	FGroundSample HomeGround;
	FGroundSample BelowGround;
	FILE* Encoder = nullptr;
};
