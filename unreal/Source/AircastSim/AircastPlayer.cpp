#include "AircastPlayer.h"

#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"

namespace
{
	constexpr double Gravity = 981.0;
	constexpr double ThrustToWeight = 5.0;
	constexpr double HoverThrottle = 1.0 / ThrustToWeight;
	constexpr double LinearDrag = 0.05;
	constexpr double QuadraticDragPerCm = 0.000075;
	constexpr double MaxAngleDegrees = 55.0;
	constexpr double AttitudeResponseSeconds = 0.12;
	constexpr double YawRateDegrees = 200.0;
	constexpr double CatchCm = 800.0;
	constexpr double GroundClearanceCm = 100.0;
	constexpr double BannerSeconds = 3.0;

	double Axis(const APlayerController* Controller, const FKey& Stick, const FKey& Plus, const FKey& Minus)
	{
		const double Keys = (Controller->IsInputKeyDown(Plus) ? 1.0 : 0.0) - (Controller->IsInputKeyDown(Minus) ? 1.0 : 0.0);
		return FMath::Clamp(Controller->GetInputAnalogKeyState(Stick) + Keys, -1.0, 1.0);
	}

	double Throttle(double Stick)
	{
		return Stick < 0.0 ? HoverThrottle * (1.0 + Stick) : HoverThrottle + Stick * (1.0 - HoverThrottle);
	}

	double Ease(double Seconds, double DeltaSeconds)
	{
		return 1.0 - FMath::Exp(-DeltaSeconds / Seconds);
	}
}

AAircastPlayer::AAircastPlayer()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Movable);
}

void AAircastPlayer::Launch(const FVector& Where)
{
	Start = Where;
	Velocity = FVector::ZeroVector;
	Pitch = Roll = 0.0;
	SetActorLocationAndRotation(Start, FRotator(0.0, Yaw, 0.0));
	bFlying = true;
}

void AAircastPlayer::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (bFlying)
	{
		Clock += DeltaSeconds;
		Fly(DeltaSeconds);
	}
}

void AAircastPlayer::Fly(double DeltaSeconds)
{
	const APlayerController* Controller = GetWorld()->GetFirstPlayerController();
	if (!Controller)
	{
		return;
	}
	Power = Throttle(Axis(Controller, EKeys::Gamepad_LeftY, EKeys::W, EKeys::S));
	const double Turn = Axis(Controller, EKeys::Gamepad_LeftX, EKeys::D, EKeys::A);
	const double Forward = Axis(Controller, EKeys::Gamepad_RightY, EKeys::Up, EKeys::Down);
	const double Side = Axis(Controller, EKeys::Gamepad_RightX, EKeys::Right, EKeys::Left);

	Yaw += Turn * YawRateDegrees * DeltaSeconds;
	Pitch += (-Forward * MaxAngleDegrees - Pitch) * Ease(AttitudeResponseSeconds, DeltaSeconds);
	Roll += (Side * MaxAngleDegrees - Roll) * Ease(AttitudeResponseSeconds, DeltaSeconds);
	const FRotator Attitude(Pitch, Yaw, Roll);
	const FVector Lift = Attitude.RotateVector(FVector::UpVector) * Power * ThrustToWeight * Gravity;
	const FVector Drag = -Velocity * (LinearDrag + QuadraticDragPerCm * Velocity.Size());
	Velocity += (Lift + Drag - FVector(0.0, 0.0, Gravity)) * DeltaSeconds;
	SetActorLocationAndRotation(GetActorLocation() + Velocity * DeltaSeconds, Attitude);
}

void AAircastPlayer::Judge(const TOptional<FVector>& Target, const TOptional<double>& GroundZ)
{
	if (!bFlying)
	{
		return;
	}
	Range = Target ? TOptional<double>(FVector::Distance(*Target, GetActorLocation()) / 100.0) : TOptional<double>();
	const bool bClose = Target && FVector::Distance(*Target, GetActorLocation()) < CatchCm;
	if (bClose && !bInside)
	{
		++Caught;
		Announce(TEXT("INTERCEPT!"));
	}
	bInside = bClose;
	if (!GroundZ)
	{
		return;
	}
	Altitude = (GetActorLocation().Z - *GroundZ) / 100.0;
	if (GetActorLocation().Z < *GroundZ + GroundClearanceCm)
	{
		++Crashed;
		Announce(TEXT("CRASHED"));
		Launch(Start);
	}
}

double AAircastPlayer::SpeedMs() const
{
	return Velocity.Size() / 100.0;
}

void AAircastPlayer::Announce(const FString& Text)
{
	Message = Text;
	MessageUntil = Clock + BannerSeconds;
}

FString AAircastPlayer::Banner() const
{
	return Clock < MessageUntil ? Message : FString();
}
