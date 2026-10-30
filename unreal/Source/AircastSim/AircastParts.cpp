#include "AircastParts.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr double MeshSize = 100.0;
}

TArray<UStaticMeshComponent*> AircastParts::Build(AActor* Owner, USceneComponent* Root, TConstArrayView<FAircastPart> Parts)
{
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	TArray<UStaticMeshComponent*> Meshes;
	for (const FAircastPart& Part : Parts)
	{
		UStaticMeshComponent* Mesh = Owner->CreateDefaultSubobject<UStaticMeshComponent>(Part.Name);
		Mesh->SetupAttachment(Root);
		Mesh->SetStaticMesh(Part.Shape == EAircastShape::Cylinder ? Cylinder.Object : Part.Shape == EAircastShape::Sphere ? Sphere.Object : Cube.Object);
		Mesh->SetRelativeLocation(Part.Center);
		Mesh->SetRelativeRotation(Part.Rotation);
		Mesh->SetRelativeScale3D(Part.Size / MeshSize);
		Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Meshes.Add(Mesh);
	}
	return Meshes;
}

void AircastParts::Paint(AActor* Owner, const TArray<TObjectPtr<UStaticMeshComponent>>& Meshes, TConstArrayView<FAircastPart> Parts)
{
	UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	for (int32 Index = 0; Index < Meshes.Num(); ++Index)
	{
		UMaterialInstanceDynamic* Colored = UMaterialInstanceDynamic::Create(Base, Owner);
		Colored->SetVectorParameterValue(TEXT("Color"), Parts[Index].Color);
		Meshes[Index]->SetMaterial(0, Colored);
	}
}
