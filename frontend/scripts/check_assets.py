"""Check shipped GLB bounds, embedded images, and reference-map projections.
Run with Python + Pillow. Does not alter assets or load a graphics context.
"""
import io
import hashlib
import json
import struct
from collections import Counter
from pathlib import Path
from PIL import Image
from orient_celestial_faces import surface, orientation

ROOT = Path(__file__).resolve().parents[1] / "public"
SIZES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
REFERENCE = ["moon", "mars", "phobos", "deimos", "jupiter", "saturn", "neptune", "venus", "bennu", "io", "europa", "ganymede", "callisto", "mercury", "pluto", "ceres", "mimas", "enceladus", "tethys", "dione", "rhea", "iapetus"]

def check(path):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", raw)
    assert (magic, version, length) == (0x46546C67, 2, len(raw)), path
    size, kind = struct.unpack_from("<II", raw, 12)
    assert kind == 0x4E4F534A and size % 4 == 0, path
    doc = json.loads(raw[20:20 + size])
    if path.parent.name == "verified" and path.stem == "hubble":
        assert hashlib.sha256(raw).hexdigest() == "e5ba4de15c7d359ac8fa1ab7e286aff42dec09c0fadae3db99252587f39fa384", (path, "Unexpected Hubble source")
        assert sum(len(mesh["primitives"]) for mesh in doc["meshes"]) == 5, (path, "Hubble draw budget")
        assert not any("uri" in item for key in ["buffers", "images"] for item in doc.get(key, [])), (path, "External Hubble resources")
    binary_size, binary_kind = struct.unpack_from("<II", raw, 20 + size)
    binary = raw[28 + size:]
    assert binary_kind == 0x004E4942 and binary_size == len(binary), path
    assert 0 <= len(binary) - doc["buffers"][0]["byteLength"] <= 3, path
    for view in doc.get("bufferViews", []):
        start, count = view.get("byteOffset", 0), view["byteLength"]
        assert view["buffer"] == 0 and start % 4 == 0, path
        assert start >= 0 and start + count <= doc["buffers"][0]["byteLength"], path
    for accessor in doc.get("accessors", []):
        if "bufferView" not in accessor:  # Draco accessors carry metadata only.
            continue
        view = doc["bufferViews"][accessor["bufferView"]]
        size = SIZES[accessor["componentType"]] * COMPONENTS[accessor["type"]]
        end = accessor.get("byteOffset", 0) + (accessor["count"] - 1) * view.get("byteStride", size) + size
        assert end <= view["byteLength"], (path, accessor)
    for descriptor in doc.get("images", []):
        if "bufferView" not in descriptor:
            continue
        view = doc["bufferViews"][descriptor["bufferView"]]
        start = view.get("byteOffset", 0)
        with Image.open(io.BytesIO(binary[start:start + view["byteLength"]])) as image:
            image.verify()
    if path.parent.name == "celestial":
        assert doc.get("extras", {}).get("orbitwatchUpAxis") == "Y", (path, "Expected glTF Y-up body geometry")
        points, indices, _, _ = surface(doc, binary)
        signs = [orientation(points, indices[i:i+3]) for i in range(0, len(indices), 3)]
        assert min(signs) >= -1e-10 and max(signs) > 0, (path, "Inward-facing body triangles")
    if path.stem in REFERENCE:
        view = doc["bufferViews"][doc["images"][0]["bufferView"]]
        start = view.get("byteOffset", 0)
        assert binary[start:start + view["byteLength"]] == (ROOT / f"textures/planets/{path.stem}.jpg").read_bytes(), path
    if doc.get("extras", {}).get("orbitwatchShape") or doc.get("extras", {}).get("orbitwatchReferenceShape"):
        points, triangles, _, _ = surface(doc, binary)
        welded = [tuple(round(v, 5) for v in point) for point in points]
        edges = Counter()
        for i in range(0, len(triangles), 3):
            a, b, c = [welded[k] for k in triangles[i:i+3]]
            if len({a, b, c}) < 3:
                continue  # Collapsed cap triangles at a sphere's poles.
            for edge in [(a, b), (b, c), (c, a)]: edges[tuple(sorted(edge))] += 1
        assert set(edges.values()) == {2}, (path, "Open or non-manifold geometry")
    if path.stem == "bennu":
        assert len(points) < 2000 and len(triangles) == 8076 and len(raw) < 350000, (path, "Bennu resource budget")
        volume = sum(orientation(points, triangles[i:i+3]) for i in range(0, len(triangles), 3)) / 6
        assert abs(volume - 4 * 3.141592653589793 / 3) < 1e-5, (path, "Expected unit volume-equivalent radius")
    if path.stem in ["saturn", "haumea"]:
        rings = doc["meshes"][0]["primitives"][1:]
        assert len(rings) == 1 and "COLOR_0" in rings[0]["attributes"], (path, "Expected one colored ring primitive")
        accessor = doc["accessors"][rings[0]["attributes"]["POSITION"]]
        assert accessor["count"] < 8000, (path, "Ring geometry exceeds vertex budget")

paths = list((ROOT / "models/celestial").glob("*.glb")) + list((ROOT / "models/satellites/verified").glob("*.glb"))
for path in paths:
    check(path)
for name in ["earth", *REFERENCE]:
    with Image.open(ROOT / f"textures/planets/{name}.jpg") as image:
        assert image.width == image.height * 2 and image.width <= 2048, name
print(f"PASS: {len(paths)} GLBs; bounds, images, outward faces, closed surfaces, {len(REFERENCE)} matching textures, and {len(REFERENCE)+1} reference-map projections.")
