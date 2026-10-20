#pragma once

#include "GameFramework/Actor.h"
#include "AircastCar.generated.h"

class UCesiumGlobeAnchorComponent;
class UMaterialInterface;
class UStaticMeshComponent;

UCLASS()
class AAircastCar : public AActor
{
	GENERATED_BODY()

public:
	AAircastCar();
	void Drive(const FVector& LongitudeLatitudeHeight, double Heading);

protected:
	virtual void BeginPlay() override;

private:
	UPROPERTY()
	TObjectPtr<UCesiumGlobeAnchorComponent> GlobeAnchor;

	UPROPERTY()
	TArray<TObjectPtr<UStaticMeshComponent>> Parts;

	UPROPERTY()
	TObjectPtr<UMaterialInterface> Paint;
};
