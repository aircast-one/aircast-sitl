import sys
from pathlib import Path

import unreal

DESTINATION = "/Game/Models"


def import_model(source):
    task = unreal.AssetImportTask()
    task.filename = str(source)
    task.destination_path = f"{DESTINATION}/{source.parent.name}/{source.stem}"
    task.automated = True
    task.replace_existing = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    meshes = [unreal.load_asset(path) for path in task.imported_object_paths]
    for mesh in (m for m in meshes if isinstance(m, unreal.StaticMesh)):
        mesh.set_editor_property("allow_cpu_access", True)
        unreal.EditorAssetLibrary.save_loaded_asset(mesh)
        unreal.log(f"Imported {mesh.get_path_name()}")


for source in sorted(Path(sys.argv[1]).glob("*/*.glb")):
    import_model(source)
