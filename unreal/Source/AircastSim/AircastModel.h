#pragma once

#include "CoreMinimal.h"

class AActor;
class USceneComponent;

struct FAircastRotor
{
	USceneComponent* Hub = nullptr;
	FVector Axis = FVector::ForwardVector;
};

namespace AircastModel
{
	bool Attach(AActor* Owner, USceneComponent* Root, const FString& Folder, double LengthCm, const FRotator& Orientation, TArray<FAircastRotor>& Rotors);
	void Spin(const TArray<FAircastRotor>& Rotors, double RevolutionsPerSecond, double DeltaSeconds);
}
