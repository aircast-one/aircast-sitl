#include "AircastHud.h"

#include "AircastPlayer.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "EngineUtils.h"

namespace
{
	constexpr float Margin = 24.0f;
	constexpr float LineScale = 1.3f;
	constexpr float BannerScale = 3.0f;
	const FLinearColor Ink(0.95f, 0.95f, 0.9f);
	const FLinearColor Alert(1.0f, 0.75f, 0.2f);
}

void AAircastHud::DrawHUD()
{
	Super::DrawHUD();
	if (!Player.IsValid())
	{
		TActorIterator<AAircastPlayer> Found(GetWorld());
		Player = Found ? *Found : nullptr;
	}
	if (!Player.IsValid() || !Player->IsFlying())
	{
		return;
	}
	UFont* Font = GEngine->GetLargeFont();
	const TOptional<double> Range = Player->RangeM();
	const FString Flight = FString::Printf(TEXT("THR %3.0f%%   SPEED %3.0f m/s   ALT %4.0f m   RANGE %s"),
		Player->ThrottlePercent(), Player->SpeedMs(), Player->AltitudeM(), Range ? *FString::Printf(TEXT("%5.0f m"), *Range) : TEXT("  ---"));
	const int32 Elapsed = FMath::FloorToInt(Player->Seconds());
	const FString Tally = FString::Printf(TEXT("INTERCEPTS %d   CRASHES %d   %02d:%02d"), Player->Intercepts(), Player->Crashes(), Elapsed / 60, Elapsed % 60);
	DrawText(Flight, Ink, Margin, Margin, Font, LineScale);
	float Width = 0.0f, Height = 0.0f;
	GetTextSize(Tally, Width, Height, Font, LineScale);
	DrawText(Tally, Ink, Canvas->ClipX - Width - Margin, Margin, Font, LineScale);
	const FString Banner = Player->Banner();
	if (!Banner.IsEmpty())
	{
		GetTextSize(Banner, Width, Height, Font, BannerScale);
		DrawText(Banner, Alert, (Canvas->ClipX - Width) / 2, Canvas->ClipY * 0.3f, Font, BannerScale);
	}
}
