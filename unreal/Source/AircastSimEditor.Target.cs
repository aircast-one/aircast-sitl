using UnrealBuildTool;

public class AircastSimEditorTarget : TargetRules
{
	public AircastSimEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("AircastSim");
	}
}
