"""Extract the cylindrical color map from NASA VTAD's documented Ceres GLB.

Run: python frontend/scripts/extract_ceres_reference.py <Ceres_1_1000.glb>
Then: python frontend/scripts/prepare_reference_assets.py ceres
The source normal map and geometry are not imported or treated as measured terrain.
"""
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
from PIL import Image

source = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(source).hexdigest() == "c43ec43aa8fb90aa8cf30660c2f2853cfac408d38149d1dc470490f4f4aa9899", "Unexpected NASA Ceres source"
size = struct.unpack_from("<I", source, 12)[0]
doc = json.loads(source[20:20 + size])
binary = source[28 + size:]
texture = doc["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
descriptor = doc["images"][doc["textures"][texture]["source"]]
assert descriptor["name"] == "ceres_diff.jpg", "Expected color map, not normal map"
view = doc["bufferViews"][descriptor["bufferView"]]
start = view.get("byteOffset", 0)
with Image.open(io.BytesIO(binary[start:start + view["byteLength"]])) as image:
    assert image.size == (4096, 2048) and image.mode == "RGBA"
    assert image.getchannel("A").getextrema() == (255, 255), "Unexpected transparency"
    image.thumbnail((2048, 1024), Image.Resampling.LANCZOS)
    target = Path(__file__).resolve().parents[1] / "public/textures/planets/ceres.jpg"
    image.convert("RGB").save(target, quality=86, optimize=True)
    print(f"Ceres reference map: {target.stat().st_size} bytes")
