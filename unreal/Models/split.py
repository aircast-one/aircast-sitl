import sys
from pathlib import Path

import numpy as np
import trimesh

PROPS = {
    "Shahed136": lambda c: np.where(c[:, 2] > 0.875, 1, 0),
    "Orlan10": lambda c: np.where(c[:, 2] > 0.507, 1, 0),
    "Zala421": lambda c: np.where(c[:, 2] > 0.462, 1, 0),
}


def part_scene(meshes, labels, label):
    picked = [m.submesh([np.flatnonzero(l == label)], append=True) for m, l in zip(meshes, labels) if (l == label).any()]
    return trimesh.Scene(picked)


def split(source, out):
    meshes = trimesh.load(source, process=False).dump()
    labels = [PROPS[source.stem](m.triangles_center) for m in meshes]
    names = sorted(set(np.concatenate(labels)))
    out.mkdir(parents=True, exist_ok=True)
    for label in names:
        name = "Body" if label == 0 else f"Prop{label}"
        part_scene(meshes, labels, label).export(out / f"{name}.glb", include_normals=True)
        print(source.stem, name, sum(int((l == label).sum()) for l in labels), "faces")


for source in sorted(Path(sys.argv[1]).glob("*.glb")):
    split(source, Path(sys.argv[2]) / source.stem)
