#pragma once

#include "GameFramework/Actor.h"
#include "AircastPlayer.generated.h"

UCLASS()
class AAircastPlayer : public AActor
{
	GENERATED_BODY()

public:
	AAircastPlayer();
	virtual void Tick(float DeltaSeconds) override;
	void Launch(const FVector& Start);
	void Judge(const TOptional<FVector>& Target, const TOptional<double>& GroundZ);
	bool IsFlying() const { return bFlying; }
	double SpeedMs() const;
	double ThrottlePercent() const { return Power * 100.0; }
	FVector VelocityCms() const { return Velocity; }
	double AltitudeM() const { return Altitude; }
	TOptional<double> RangeM() const { return Range; }
	int32 Intercepts() const { return Caught; }
	int32 Crashes() const { return Crashed; }
	double Seconds() const { return Clock; }
	FString Banner() const;

private:
	void Fly(double DeltaSeconds);
	void Announce(const FString& Text);

	FVector Start = FVector::ZeroVector;
	FVector Velocity = FVector::ZeroVector;
	double Yaw = 0.0;
	double Pitch = 0.0;
	double Roll = 0.0;
	double Power = 0.0;
	double Altitude = 0.0;
	TOptional<double> Range;
	bool bFlying = false;
	bool bInside = false;
	int32 Caught = 0;
	int32 Crashed = 0;
	double Clock = 0.0;
	FString Message;
	double MessageUntil = 0.0;
};
