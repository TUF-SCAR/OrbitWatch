"""Replace cracked per-vertex noise with continuous illustrative body surfaces.
UVs, materials and reference maps are retained. These are not measured shapes.
"""
import json
import math
import struct
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1] / "public/models/celestial"
SHAPES = {
    "phobos": (1.20, 1, .83), "deimos": (1.18, .98, .87),
    "eros": (1.7, .75, .78), "apophis": (1.35, .88, .84),
    "haumea": (1.5, .75, .89), "bennu": (1.10, .84, 1.08),
    "ceres": (1.02, .97, 1.01), "miranda": (1, 1, 1),
    "proteus": (1.06, 1, .94), "vesta": (1.12, .85, 1.05),
    "pallas": (1.05, .93, 1.02), "hygiea": (1.03, .95, 1.02),
    "psyche": (1.2, .83, 1), "styx": (1.35, .83, .89),
    "nix": (1.25, .9, .89), "kerberos": (1.4, .83, .86), "hydra": (1.3, .88, .87),
}

def read(path):
    raw = path.read_bytes()
    n = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20+n]), bytearray(raw[28+n:])

def values(doc, binary, index, fmt, components):
    accessor = doc["accessors"][index]
    view = doc["bufferViews"][accessor["bufferView"]]
    return struct.unpack_from("<" + fmt * accessor["count"] * components, binary, view.get("byteOffset", 0))

base, base_binary = read(ROOT / "mars.glb")
unit = values(base, base_binary, 0, "f", 3)
for name, axes in SHAPES.items():
    path = ROOT / f"{name}.glb"
    doc, binary = read(path)
    if doc.get("extras", {}).get("orbitwatchReferenceShape"):
        continue  # Preserve imported reference geometry on subsequent repairs.
    assert doc["accessors"][0]["count"] == len(unit) // 3
    positions = []
    volume_scale = (axes[0] * axes[1] * axes[2]) ** (1/3)
    for index in range(0, len(unit), 3):
        x, y, z = unit[index:index+3]
        # Cartesian noise is continuous across the longitude seam and both poles.
        roughness = .008 if name in ["ceres", "miranda"] else .035
        radius = 1 + roughness * (math.sin(x*4 + z*2) * math.cos(y*5) + .4*math.sin(z*5-x))
        positions.extend([x*axes[0]*radius/volume_scale, y*axes[1]*radius/volume_scale, z*axes[2]*radius/volume_scale])
    points = [positions[i:i+3] for i in range(0, len(positions), 3)]
    keys = [tuple(round(value, 6) for value in point) for point in points]
    normals = defaultdict(lambda: [0., 0., 0.])
    indices = values(doc, binary, 3, "I", 1)
    for i in range(0, len(indices), 3):
        triangle = indices[i:i+3]
        a, b, c = [points[k] for k in triangle]
        u, v = [b[k]-a[k] for k in range(3)], [c[k]-a[k] for k in range(3)]
        normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        if sum(normal[k]*a[k] for k in range(3)) < 0:
            normal = [-value for value in normal]
        for vertex in triangle:
            for k in range(3): normals[keys[vertex]][k] += normal[k]
    normal_values = []
    for key in keys:
        normal = normals[key]
        length = math.sqrt(sum(value*value for value in normal))
        assert length > 0, (name, key)
        normal_values.extend(value/length for value in normal)
    for index, replacement in [(0, positions), (1, normal_values)]:
        view = doc["bufferViews"][doc["accessors"][index]["bufferView"]]
        packed = struct.pack("<" + "f" * len(replacement), *replacement)
        assert len(packed) == view["byteLength"]
        start = view.get("byteOffset", 0)
        binary[start:start+len(packed)] = packed
    doc["accessors"][0].update(min=[min(p[k] for p in points) for k in range(3)], max=[max(p[k] for p in points) for k in range(3)])
    doc.setdefault("extras", {})["orbitwatchShape"] = "Continuous illustrative surface; not a measured shape model."
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    path.write_bytes(struct.pack("<III", 0x46546C67, 2, 28+len(encoded)+len(binary)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(binary), 0x004E4942) + binary)
    print(name)
