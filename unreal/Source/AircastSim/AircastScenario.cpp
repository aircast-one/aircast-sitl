#include "AircastScenario.h"

#include "Algo/Transform.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

namespace
{
	const TMap<FString, FLinearColor> Paints = {
		{TEXT("factory"), FLinearColor::White},
		{TEXT("black"), FLinearColor(0.045f, 0.045f, 0.05f)},
		{TEXT("grey"), FLinearColor(0.32f, 0.33f, 0.33f)},
		{TEXT("white"), FLinearColor(0.85f, 0.85f, 0.84f)},
	};
	constexpr double DefaultSolarTime = 12.0;
	constexpr float DefaultCloudCover = 0.1f;
	constexpr double EarliestSolarTime = 7.0;
	constexpr double LatestSolarTime = 18.0;
	constexpr float MostCloudCover = 0.6f;

	template <typename T>
	T Pick(const FRandomStream& Dice, const TArray<T>& Options)
	{
		return Options[Dice.RandRange(0, Options.Num() - 1)];
	}

	FAircastScenario Parse()
	{
		const TCHAR* CommandLine = FCommandLine::Get();
		int32 Seed = 0;
		const bool bRandom = FParse::Value(CommandLine, TEXT("Random="), Seed) || FParse::Param(CommandLine, TEXT("Random"));
		const FRandomStream Dice(Seed ? Seed : static_cast<int32>(FPlatformTime::Cycles()));

		TArray<FString> Names;
		Algo::Transform(AircastTargets(), Names, &FAircastTarget::Name);
		FString Name = bRandom ? Pick(Dice, Names) : Names[0];
		FParse::Value(CommandLine, TEXT("Target="), Name);
		const int32 Class = Names.IndexOfByKey(Name);
		UE_CLOG(Class == INDEX_NONE, LogTemp, Fatal, TEXT("Unknown -Target=%s, expected one of %s"), *Name, *FString::Join(Names, TEXT("|")));
		const FAircastTarget& Target = AircastTargets()[Class];

		TArray<FString> Schemes;
		Paints.GetKeys(Schemes);
		FString Paint = bRandom ? Pick(Dice, Schemes) : Target.Paint;
		FParse::Value(CommandLine, TEXT("Paint="), Paint);
		UE_CLOG(!Paints.Contains(Paint), LogTemp, Fatal, TEXT("Unknown -Paint=%s, expected one of %s"), *Paint, *FString::Join(Schemes, TEXT("|")));

		double SolarTime = bRandom ? Dice.FRandRange(EarliestSolarTime, LatestSolarTime) : DefaultSolarTime;
		FParse::Value(CommandLine, TEXT("SolarTime="), SolarTime);
		float CloudCover = bRandom ? Dice.FRandRange(0.0f, MostCloudCover) : DefaultCloudCover;
		FParse::Value(CommandLine, TEXT("CloudCover="), CloudCover);
		return {Class, Target, Paint, Paints[Paint], SolarTime, CloudCover};
	}
}

const TArray<FAircastTarget>& AircastTargets()
{
	static const TArray<FAircastTarget> Targets = {
		{TEXT("shahed136"), TEXT("/Game/Models/Shahed136"), 350.0, FRotator(0.0, 90.0, 0.0), TEXT("black")},
		{TEXT("orlan10"), TEXT("/Game/Models/Orlan10"), 310.0, FRotator(0.0, -90.0, 0.0), TEXT("factory")},
		{TEXT("zala421"), TEXT("/Game/Models/Zala421"), 180.0, FRotator(0.0, -90.0, 0.0), TEXT("factory")},
	};
	return Targets;
}

const FAircastScenario& AircastScenario()
{
	static const FAircastScenario Scenario = Parse();
	return Scenario;
}

FString FAircastScenario::Describe() const
{
	return FString::Printf(TEXT("{\"target\": \"%s\", \"class\": %d, \"paint\": \"%s\", \"solar_time\": %.2f, \"cloud_cover\": %.2f}\n"),
		*Target.Name, Class, *Paint, SolarTime, CloudCover);
}
