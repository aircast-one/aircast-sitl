#pragma once

#include "CoreMinimal.h"

struct FAircastTarget
{
	FString Name;
	FString Folder;
	double LengthCm;
	FRotator Orientation;
	FString Paint;
};

struct FAircastScenario
{
	int32 Class;
	FAircastTarget Target;
	FString Paint;
	FLinearColor Livery;
	double SolarTime;
	float CloudCover;
	FString Describe() const;
};

const TArray<FAircastTarget>& AircastTargets();
const FAircastScenario& AircastScenario();
