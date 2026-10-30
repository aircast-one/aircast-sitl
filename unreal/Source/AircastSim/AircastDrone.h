#pragma once

#include "AircastModel.h"
#include "GameFramework/Actor.h"
#include "AircastDrone.generated.h"

class UCesiumGlobeAnchorComponent;
class UStaticMeshComponent;

UCLASS()
class AAircastDrone : public AActor
{
	GENERATED_BODY()

public:
	AAircastDrone();
	void Fly(const FVector& LongitudeLatitudeHeight, double Heading, double Pitch, double Roll);
	TArray<FVector> Silhouette() const;

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	UPROPERTY()
	TObjectPtr<UCesiumGlobeAnchorComponent> GlobeAnchor;

	UPROPERTY()
	TArray<TObjectPtr<UStaticMeshComponent>> Parts;

	TArray<FAircastRotor> Rotors;

	TArray<TPair<TWeakObjectPtr<UStaticMeshComponent>, TArray<FVector3f>>> Hull;
};
