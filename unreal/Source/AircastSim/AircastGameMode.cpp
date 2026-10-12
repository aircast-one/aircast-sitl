#include "AircastGameMode.h"
#include "AircastCamera.h"

AAircastGameMode::AAircastGameMode()
{
	DefaultPawnClass = nullptr;
}

void AAircastGameMode::StartPlay()
{
	Super::StartPlay();
	GetWorld()->SpawnActor<AAircastCamera>();
}
