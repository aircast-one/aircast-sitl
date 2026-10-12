using UnrealBuildTool;

public class AircastSim : ModuleRules
{
	public AircastSim(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "WebSockets", "Json", "CesiumRuntime" });
	}
}
