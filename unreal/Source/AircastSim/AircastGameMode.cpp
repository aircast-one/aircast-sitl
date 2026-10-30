#include "AircastGameMode.h"
#include "AircastCamera.h"
#include "AircastHud.h"

AAircastGameMode::AAircastGameMode()
{
	DefaultPawnClass = nullptr;
	HUDClass = AAircastHud::StaticClass();
}

void AAircastGameMode::StartPlay()
{
	Super::StartPlay();
	GetWorld()->SpawnActor<AAircastCamera>();
}
