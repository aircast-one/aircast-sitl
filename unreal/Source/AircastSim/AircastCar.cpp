#include "AircastCar.h"

#include "CesiumGlobeAnchorComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	struct FPart
	{
		const TCHAR* Name;
		bool bWheel;
		FVector Center;
		FVector Size;
		FLinearColor Color;
	};

	const FLinearColor White(0.8f, 0.8f, 0.8f);
	const FLinearColor Blue(0.03f, 0.1f, 0.35f);
	const FLinearColor Tyre(0.02f, 0.02f, 0.02f);
	const FPart Shape[] = {
		{TEXT("Box"), false, FVector(-60.0, 0.0, 145.0), FVector(300.0, 190.0, 190.0), White},
		{TEXT("Cab"), false, FVector(165.0, 0.0, 115.0), FVector(150.0, 180.0, 130.0), Blue},
		{TEXT("FrontLeft"), true, FVector(160.0, -90.0, 35.0), FVector(70.0, 70.0, 25.0), Tyre},
		{TEXT("FrontRight"), true, FVector(160.0, 90.0, 35.0), FVector(70.0, 70.0, 25.0), Tyre},
		{TEXT("RearLeft"), true, FVector(-130.0, -90.0, 35.0), FVector(70.0, 70.0, 25.0), Tyre},
		{TEXT("RearRight"), true, FVector(-130.0, 90.0, 35.0), FVector(70.0, 70.0, 25.0), Tyre},
	};
	constexpr double MeshSize = 100.0;
}

AAircastCar::AAircastCar()
{
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Movable);
	GlobeAnchor = CreateDefaultSubobject<UCesiumGlobeAnchorComponent>(TEXT("GlobeAnchor"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> Material(TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	Paint = Material.Object;
	for (const FPart& Part : Shape)
	{
		UStaticMeshComponent* Mesh = CreateDefaultSubobject<UStaticMeshComponent>(Part.Name);
		Mesh->SetupAttachment(RootComponent);
		Mesh->SetStaticMesh(Part.bWheel ? Cylinder.Object : Cube.Object);
		Mesh->SetRelativeLocation(Part.Center);
		Mesh->SetRelativeRotation(Part.bWheel ? FRotator(0.0, 0.0, 90.0) : FRotator::ZeroRotator);
		Mesh->SetRelativeScale3D(Part.Size / MeshSize);
		Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Parts.Add(Mesh);
	}
	SetActorHiddenInGame(true);
}

void AAircastCar::BeginPlay()
{
	Super::BeginPlay();
	for (int32 Index = 0; Index < Parts.Num(); ++Index)
	{
		UMaterialInstanceDynamic* Colored = UMaterialInstanceDynamic::Create(Paint, this);
		Colored->SetVectorParameterValue(TEXT("Color"), Shape[Index].Color);
		Parts[Index]->SetMaterial(0, Colored);
	}
}

void AAircastCar::Drive(const FVector& LongitudeLatitudeHeight, double Heading)
{
	GlobeAnchor->MoveToLongitudeLatitudeHeight(LongitudeLatitudeHeight);
	GlobeAnchor->SetEastSouthUpRotation(FRotator(0.0, FMath::RadiansToDegrees(Heading) - 90.0, 0.0).Quaternion());
	SetActorHiddenInGame(false);
}
