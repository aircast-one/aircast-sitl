#pragma once

#include "GameFramework/HUD.h"
#include "AircastHud.generated.h"

class AAircastPlayer;

UCLASS()
class AAircastHud : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	TWeakObjectPtr<AAircastPlayer> Player;
};
