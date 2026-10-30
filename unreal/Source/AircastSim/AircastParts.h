#pragma once

#include "CoreMinimal.h"
#include "UObject/ObjectPtr.h"

class AActor;
class UMaterialInterface;
class UStaticMeshComponent;
class USceneComponent;

enum class EAircastShape
{
	Cube,
	Cylinder,
	Sphere,
};

struct FAircastPart
{
	const TCHAR* Name;
	EAircastShape Shape;
	FVector Center;
	FVector Size;
	FRotator Rotation;
	FLinearColor Color;
};

namespace AircastParts
{
	TArray<UStaticMeshComponent*> Build(AActor* Owner, USceneComponent* Root, TConstArrayView<FAircastPart> Parts);
	void Paint(AActor* Owner, const TArray<TObjectPtr<UStaticMeshComponent>>& Meshes, TConstArrayView<FAircastPart> Parts);
}
