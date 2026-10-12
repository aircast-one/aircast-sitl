#pragma once

#include "GameFramework/GameModeBase.h"
#include "AircastGameMode.generated.h"

UCLASS()
class AAircastGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AAircastGameMode();
	virtual void StartPlay() override;
};
