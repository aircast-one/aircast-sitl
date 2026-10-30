#include "AircastModel.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"

namespace
{
	const TCHAR* RotorPrefix = TEXT("Prop");

	FBox Bounds(const TArray<UStaticMesh*>& Meshes)
	{
		FBox Box(ForceInit);
		for (const UStaticMesh* Mesh : Meshes)
		{
			Box += Mesh->GetBoundingBox();
		}
		return Box;
	}

	FVector ThinnestAxis(const FBox& Box)
	{
		const FVector Size = Box.GetSize();
		return Size.X <= Size.Y && Size.X <= Size.Z ? FVector::ForwardVector : Size.Y <= Size.Z ? FVector::RightVector : FVector::UpVector;
	}

	void Place(AActor* Owner, USceneComponent* Parent, const TArray<UStaticMesh*>& Meshes, const FVector& Offset)
	{
		for (UStaticMesh* Mesh : Meshes)
		{
			UStaticMeshComponent* Part = NewObject<UStaticMeshComponent>(Owner);
			Part->SetStaticMesh(Mesh);
			Part->SetupAttachment(Parent);
			Part->SetRelativeLocation(Offset);
			Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Part->RegisterComponent();
		}
	}
}

bool AircastModel::Attach(AActor* Owner, USceneComponent* Root, const FString& Folder, double LengthCm, const FRotator& Orientation, TArray<FAircastRotor>& Rotors)
{
	IAssetRegistry& Registry = FAssetRegistryModule::GetRegistry();
	Registry.ScanPathsSynchronous({Folder}, true);
	TArray<FAssetData> Found;
	Registry.GetAssetsByPath(FName(*Folder), Found, true);
	TMap<FString, TArray<UStaticMesh*>> Parts;
	for (const FAssetData& Asset : Found)
	{
		if (UStaticMesh* Mesh = Cast<UStaticMesh>(Asset.GetAsset()))
		{
			FString Part;
			Asset.PackagePath.ToString().RightChop(Folder.Len() + 1).Split(TEXT("/"), &Part, nullptr);
			Parts.FindOrAdd(Part.IsEmpty() ? Asset.PackagePath.ToString() : Part).Add(Mesh);
		}
	}
	if (Parts.IsEmpty())
	{
		return false;
	}
	TArray<UStaticMesh*> All;
	for (const TPair<FString, TArray<UStaticMesh*>>& Part : Parts)
	{
		All.Append(Part.Value);
	}
	const FBox Box = Bounds(All);
	USceneComponent* Pivot = NewObject<USceneComponent>(Owner);
	Pivot->SetupAttachment(Root);
	Pivot->SetRelativeRotation(Orientation);
	Pivot->SetRelativeScale3D(FVector(LengthCm / Box.GetSize().GetMax()));
	Pivot->RegisterComponent();
	for (const TPair<FString, TArray<UStaticMesh*>>& Part : Parts)
	{
		if (!Part.Key.StartsWith(RotorPrefix))
		{
			Place(Owner, Pivot, Part.Value, -Box.GetCenter());
			continue;
		}
		const FBox Disc = Bounds(Part.Value);
		USceneComponent* Hub = NewObject<USceneComponent>(Owner);
		Hub->SetupAttachment(Pivot);
		Hub->SetRelativeLocation(Disc.GetCenter() - Box.GetCenter());
		Hub->RegisterComponent();
		Place(Owner, Hub, Part.Value, -Disc.GetCenter());
		Rotors.Add({Hub, ThinnestAxis(Disc)});
	}
	return true;
}

void AircastModel::Spin(const TArray<FAircastRotor>& Rotors, double RevolutionsPerSecond, double DeltaSeconds)
{
	for (const FAircastRotor& Rotor : Rotors)
	{
		Rotor.Hub->AddLocalRotation(FQuat(Rotor.Axis, UE_TWO_PI * RevolutionsPerSecond * DeltaSeconds));
	}
}
