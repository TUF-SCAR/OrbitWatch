"""Repack NASA VTAD Bennu geometry with the OSIRIS-REx overview mosaic.

Usage: python prepare_bennu_reference.py source.glb mosaic.jpg
Sources and limitations: docs/ASSETS.md. Only uniform normalization and UV
projection change geometry data; no invented displacement or decimation.
"""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
from PIL import Image
from orient_celestial_faces import surface, orientation

ROOT = Path(__file__).resolve().parents[1] / "public"


def prepare(source, texture):
    raw = source.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == "b7740b53a77ff538082d26e7079510ef7810fc3de9a5ff0fa316b393d2cf700e", "Unrecognized NASA source; review provenance before replacing"
    assert hashlib.sha256(texture.read_bytes()).hexdigest() == "b321bf5a95d5ec2f48781a58a6f151fd2ea88293a8df14ccd983dd36bd666280", "Unrecognized mosaic; review provenance before replacing"
    size = struct.unpack_from("<I", raw, 12)[0]
    doc, binary = json.loads(raw[20:20 + size]), raw[28 + size:]
    points, indices, _, _ = surface(doc, binary)
    assert len(points) == 1419 and len(indices) == 8076, "Expected compact NASA VTAD Bennu source"
    assert doc["nodes"] == [{"mesh": 0, "name": "bennu"}], "Unexpected source transform"
    volume = sum(orientation(points, indices[i:i+3]) for i in range(0, len(indices), 3)) / 6
    radius = (3 * volume / (4 * math.pi)) ** (1 / 3)
    assert 245 < radius < 247, "Unexpected source units or orientation"
    with Image.open(texture) as image:
        assert image.size == (1024, 512) and image.format == "JPEG", "Expected bounded NASA SVS mosaic"
        image.verify()
    normal_accessor = doc["accessors"][1]
    normal_view = doc["bufferViews"][normal_accessor["bufferView"]]
    normals = list(struct.iter_unpack("<fff", binary[normal_view["byteOffset"]:normal_view["byteOffset"] + normal_view["byteLength"]]))
    positions = [tuple(v / radius for v in point) for point in points]
    uv = [(0.5 + math.atan2(-z, x) / (2 * math.pi), math.acos(max(-1, min(1, y / math.sqrt(x*x+y*y+z*z)))) / math.pi) for x, y, z in points]
    # Duplicate just the wrap-edge vertices, preserving geometry and normals.
    wrapped = {}
    for i in range(0, len(indices), 3):
        triangle = indices[i:i+3]
        us = [uv[index][0] for index in triangle]
        if max(us) - min(us) <= 0.5:
            continue
        for j, index in enumerate(triangle):
            if uv[index][0] >= 0.5:
                continue
            if index not in wrapped:
                wrapped[index] = len(positions)
                positions.append(positions[index])
                normals.append(normals[index])
                uv.append((uv[index][0] + 1, uv[index][1]))
            indices[i+j] = wrapped[index]
    chunks, views, accessors = [], [], []

    def add(data, component_type=None, count=None, kind=None, bounds=None):
        offset = sum(len(chunk) for chunk in chunks)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        chunks.append(data + b"\0" * (-len(data) % 4))
        if component_type:
            accessor = {"bufferView": len(views)-1, "componentType": component_type, "count": count, "type": kind}
            if bounds:
                accessor.update(min=bounds[0], max=bounds[1])
            accessors.append(accessor)

    for values, kind in [(positions, "VEC3"), (normals, "VEC3"), (uv, "VEC2")]:
        flat = [v for item in values for v in item]
        bounds = ([min(p[k] for p in positions) for k in range(3)], [max(p[k] for p in positions) for k in range(3)]) if values is positions else None
        add(struct.pack("<" + "f" * len(flat), *flat), 5126, len(values), kind, bounds)
    add(struct.pack("<" + "H" * len(indices), *indices), 5123, len(indices), "SCALAR")
    add(texture.read_bytes())
    doc.update(bufferViews=views, accessors=accessors, images=[{"bufferView": 4, "mimeType": "image/jpeg"}])
    doc["samplers"] = [{"wrapS": 10497, "wrapT": 33071, "minFilter": 9987, "magFilter": 9729}]
    doc["textures"] = [{"sampler": 0, "source": 0}]
    doc["materials"][0]["pbrMetallicRoughness"].update(metallicFactor=0, roughnessFactor=1)
    doc["asset"]["copyright"] = "Geometry: NASA VTAD. Mosaic: NASA/University of Arizona/CSA/York University/MDA; NASA SVS. See docs/ASSETS.md."
    doc["extras"] = {"orbitwatchUpAxis": "Y", "orbitwatchReferenceShape": "NASA VTAD Bennu, uniformly normalized by volume-equivalent radius; approximate orientation/map alignment", "sourceSha256": hashlib.sha256(raw).hexdigest(), "sourceRadius": radius}
    binary = b"".join(chunks)
    doc["buffers"] = [{"byteLength": len(binary)}]
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    output = ROOT / "models/celestial/bennu.glb"
    output.write_bytes(struct.pack("<III", 0x46546C67, 2, 28+len(encoded)+len(binary)) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(binary), 0x004E4942) + binary)
    (ROOT / "textures/planets/bennu.jpg").write_bytes(texture.read_bytes())
    print(f"Bennu: {len(positions)} vertices, {len(indices)//3} triangles, {output.stat().st_size} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    prepare(Path(sys.argv[1]), Path(sys.argv[2]))
