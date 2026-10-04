"""Orient the existing star-shaped celestial surfaces outward, without reshaping.

Legacy triangle indices faced inward despite outward vertex normals. Only the
base body's index order changes; rings, positions, UVs and textures stay intact.
The geometric test makes this safe to rerun after other asset preparation.
"""
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public/models/celestial"


def surface(doc, binary):
    primitive = doc["meshes"][0]["primitives"][0]
    assert primitive.get("mode", 4) == 4
    accessor = doc["accessors"][primitive["attributes"]["POSITION"]]
    view = doc["bufferViews"][accessor["bufferView"]]
    assert accessor["componentType"] == 5126 and "byteStride" not in view
    values = struct.unpack_from("<" + "f" * accessor["count"] * 3, binary,
                                view.get("byteOffset", 0) + accessor.get("byteOffset", 0))
    points = [values[i:i+3] for i in range(0, len(values), 3)]
    accessor = doc["accessors"][primitive["indices"]]
    view = doc["bufferViews"][accessor["bufferView"]]
    fmt = "<" + {5123: "H", 5125: "I"}[accessor["componentType"]] * accessor["count"]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return points, list(struct.unpack_from(fmt, binary, offset)), fmt, offset


def orientation(points, triangle):
    a, b, c = [points[index] for index in triangle]
    u, v = [b[k]-a[k] for k in range(3)], [c[k]-a[k] for k in range(3)]
    cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
    return sum(a[k]*cross[k] for k in range(3))


def repair(path):
    raw = bytearray(path.read_bytes())
    size = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20+size])
    points, indices, fmt, offset = surface(doc, raw[28+size:])
    count = 0
    for i in range(0, len(indices), 3):
        if orientation(points, indices[i:i+3]) < -1e-10:
            indices[i+1], indices[i+2] = indices[i+2], indices[i+1]
            count += 1
    if count:
        struct.pack_into(fmt, raw, 28+size+offset, *indices)
        path.write_bytes(raw)
    return count


if __name__ == "__main__":
    for path in ROOT.glob("*.glb"):
        print(f"{path.stem}: {repair(path)} inward faces corrected")
