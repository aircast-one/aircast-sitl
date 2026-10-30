#include "AircastDrone.h"

#include "AircastModel.h"
#include "AircastParts.h"
#include "AircastScenario.h"
#include "CesiumGlobeAnchorComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/Texture.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "StaticMeshResources.h"

namespace
{
	constexpr int32 HullPointsPerMesh = 1500;
	const FLinearColor PropPaint(0.035f, 0.035f, 0.038f);

	constexpr float PaintRoughness = 0.75f;
	constexpr float PaintSpecular = 0.3f;
	const TCHAR* Untextured = TEXT("/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture");

	void Repaint(UPrimitiveComponent* Mesh, const FLinearColor& Color)
	{
		UTexture* White = LoadObject<UTexture>(nullptr, Untextured);
		for (int32 Slot = 0; Slot < Mesh->GetNumMaterials(); ++Slot)
		{
			UMaterialInstanceDynamic* Paint = Mesh->CreateDynamicMaterialInstance(Slot);
			Paint->SetVectorParameterValue(TEXT("BaseColorFactor"), Color);
			Paint->SetScalarParameterValue(TEXT("MetallicFactor"), 0.0f);
			Paint->SetTextureParameterValue(TEXT("MetallicRoughnessTexture"), White);
			Paint->SetScalarParameterValue(TEXT("RoughnessFactor"), PaintRoughness);
			Paint->SetScalarParameterValue(TEXT("SpecularFactor"), PaintSpecular);
		}
	}
	constexpr double RevolutionsPerSecond = 45.0;
	const FLinearColor Body(0.42f, 0.44f, 0.42f);
	const FLinearColor Prop(0.03f, 0.03f, 0.03f);
	const FRotator AlongX(90.0, 0.0, 0.0);
	const FAircastPart Shape[] = {
		{TEXT("Fuselage"), EAircastShape::Cylinder, FVector(0.0, 0.0, 0.0), FVector(24.0, 24.0, 190.0), AlongX, Body},
		{TEXT("Nose"), EAircastShape::Sphere, FVector(95.0, 0.0, 0.0), FVector(24.0, 24.0, 24.0), FRotator::ZeroRotator, Body},
		{TEXT("Wing"), EAircastShape::Cube, FVector(20.0, 0.0, 12.0), FVector(34.0, 320.0, 4.0), FRotator::ZeroRotator, Body},
		{TEXT("Tailplane"), EAircastShape::Cube, FVector(-88.0, 0.0, 4.0), FVector(24.0, 100.0, 3.0), FRotator::ZeroRotator, Body},
		{TEXT("Fin"), EAircastShape::Cube, FVector(-90.0, 0.0, 22.0), FVector(28.0, 3.0, 38.0), FRotator::ZeroRotator, Body},
		{TEXT("Propeller"), EAircastShape::Cylinder, FVector(-100.0, 0.0, 0.0), FVector(55.0, 55.0, 2.0), AlongX, Prop},
	};
}

AAircastDrone::AAircastDrone()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Movable);
	GlobeAnchor = CreateDefaultSubobject<UCesiumGlobeAnchorComponent>(TEXT("GlobeAnchor"));
	Parts.Append(AircastParts::Build(this, RootComponent, Shape));
	SetActorHiddenInGame(true);
}

void AAircastDrone::BeginPlay()
{
	Super::BeginPlay();
	const FAircastScenario& Scenario = AircastScenario();
	if (AircastModel::Attach(this, RootComponent, *Scenario.Target.Folder, Scenario.Target.LengthCm, Scenario.Target.Orientation, Rotors))
	{
		for (UStaticMeshComponent* Part : Parts)
		{
			Part->SetVisibility(false);
		}
		TInlineComponentArray<UStaticMeshComponent*> Meshes(this);
		for (UStaticMeshComponent* Mesh : Meshes)
		{
			const bool bProp = Rotors.ContainsByPredicate([Mesh](const FAircastRotor& Rotor) { return Mesh->GetAttachParent() == Rotor.Hub; });
			if (Mesh->IsVisible())
			{
				Repaint(Mesh, bProp ? PropPaint : Scenario.Livery);
			}
		}
		for (UStaticMeshComponent* Mesh : Meshes)
		{
			const FStaticMeshRenderData* RenderData = Mesh->IsVisible() && Mesh->GetStaticMesh() ? Mesh->GetStaticMesh()->GetRenderData() : nullptr;
			if (!RenderData || RenderData->LODResources.IsEmpty() || !RenderData->LODResources[0].VertexBuffers.PositionVertexBuffer.GetVertexData())
			{
				continue;
			}
			const FPositionVertexBuffer& Positions = RenderData->LODResources[0].VertexBuffers.PositionVertexBuffer;
			const uint32 Stride = FMath::Max<uint32>(1, Positions.GetNumVertices() / HullPointsPerMesh);
			TArray<FVector3f> Points;
			for (uint32 Index = 0; Index < Positions.GetNumVertices(); Index += Stride)
			{
				Points.Add(Positions.VertexPosition(Index));
			}
			Hull.Add({Mesh, MoveTemp(Points)});
		}
		return;
	}
	AircastParts::Paint(this, Parts, Shape);
}

void AAircastDrone::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	AircastModel::Spin(Rotors, RevolutionsPerSecond, DeltaSeconds);
}

void AAircastDrone::Fly(const FVector& LongitudeLatitudeHeight, double Heading, double Pitch, double Roll)
{
	GlobeAnchor->MoveToLongitudeLatitudeHeight(LongitudeLatitudeHeight);
	GlobeAnchor->SetEastSouthUpRotation(
		FRotator(FMath::RadiansToDegrees(Pitch), FMath::RadiansToDegrees(Heading) - 90.0, FMath::RadiansToDegrees(Roll)).Quaternion());
	SetActorHiddenInGame(false);
}

TArray<FVector> AAircastDrone::Silhouette() const
{
	TArray<FVector> Points;
	for (const TPair<TWeakObjectPtr<UStaticMeshComponent>, TArray<FVector3f>>& Part : Hull)
	{
		if (const UStaticMeshComponent* Mesh = Part.Key.Get())
		{
			const FTransform Placed = Mesh->GetComponentTransform();
			for (const FVector3f& Point : Part.Value)
			{
				Points.Add(Placed.TransformPosition(FVector(Point)));
			}
		}
	}
	if (Points.IsEmpty())
	{
		const FBox Bounds = GetComponentsBoundingBox();
		for (int32 Corner = 0; Corner < 8; ++Corner)
		{
			Points.Add(FVector(Corner & 1 ? Bounds.Max.X : Bounds.Min.X, Corner & 2 ? Bounds.Max.Y : Bounds.Min.Y, Corner & 4 ? Bounds.Max.Z : Bounds.Min.Z));
		}
	}
	return Points;
}
