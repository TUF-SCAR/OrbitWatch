"""Normalize legacy Z-up sphere geometry to glTF's Y-up convention.
Generated ring primitives already use Y-up and are left intact.
"""
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public/models/celestial"
for path in ROOT.glob("*.glb"):
    raw = path.read_bytes()
    n = struct.unpack_from("<I", raw, 12)[0]
    doc, binary = json.loads(raw[20:20+n]), bytearray(raw[28+n:])
    if doc.get("extras", {}).get("orbitwatchUpAxis") == "Y":
        continue
    primitive = doc["meshes"][0]["primitives"][0]
    for semantic in ["POSITION", "NORMAL"]:
        accessor = doc["accessors"][primitive["attributes"][semantic]]
        assert accessor["type"] == "VEC3" and accessor["componentType"] == 5126
        view = doc["bufferViews"][accessor["bufferView"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        values = struct.unpack_from("<" + "f" * accessor["count"] * 3, binary, start)
        points = [(values[i], values[i+2], -values[i+1]) for i in range(0, len(values), 3)]
        packed = struct.pack("<" + "f" * len(values), *(v for point in points for v in point))
        binary[start:start+len(packed)] = packed
        if semantic == "POSITION":
            accessor.update(min=[min(p[k] for p in points) for k in range(3)], max=[max(p[k] for p in points) for k in range(3)])
    doc.setdefault("extras", {})["orbitwatchUpAxis"] = "Y"
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    path.write_bytes(struct.pack("<III", 0x46546C67, 2, 28+len(encoded)+len(binary)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(binary), 0x004E4942) + binary)
    print(path.stem)
