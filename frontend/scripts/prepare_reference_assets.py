"""Repack existing low-poly celestial GLBs with documented NASA reference maps.
Run with Python + Pillow. Original geometry is retained; no measured terrain is implied.
"""
import json
import struct
import sys
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]

def read_glb(path):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + size]), data[28 + size:]

def write_glb(path, doc, binary):
    doc['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(binary)) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + struct.pack('<II', len(binary), 0x004E4942) + binary)

def optimize_image(image, target, width):
    # Preserve already bounded JPEGs byte-for-byte. Repeated lossy encoding
    # degraded the supplied maps and made regeneration non-idempotent.
    if image.format == 'JPEG' and image.mode == 'RGB' and image.width <= width and image.height <= width:
        return
    image.thumbnail((width, width // 2 if width > 1000 else width), Image.Resampling.LANCZOS)
    image.convert('RGB').save(target, quality=86, optimize=True)

# Input maps must be equirectangular; a spacecraft model's UV atlas is not interchangeable.
BODIES = ['moon', 'mars', 'phobos', 'deimos', 'jupiter', 'saturn', 'neptune', 'venus', 'io', 'europa', 'ganymede', 'callisto', 'mercury', 'pluto', 'ceres', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus']
CREDITS = {
    'ceres': 'NASA Visualization Technology Applications and Development (VTAD)',
    'mercury': 'NASA / Johns Hopkins University Applied Physics Laboratory / Carnegie Institution of Washington',
    'pluto': 'NASA / Johns Hopkins University Applied Physics Laboratory / Southwest Research Institute',
    'moon': 'NASA Scientific Visualization Studio / LRO / LROC',
    **dict.fromkeys(['io', 'europa', 'ganymede', 'callisto', 'mars', 'phobos', 'deimos', 'mimas', 'tethys', 'dione', 'rhea', 'iapetus'], 'NASA / JPL / Caltech / USGS'),
    'enceladus': 'NASA / JPL-Caltech / Space Science Institute / Lunar and Planetary Institute',
}
selected = sys.argv[1:] or BODIES
if any(body not in BODIES for body in selected):
    raise ValueError('Unknown reference body')
for body in selected:
    texture = ROOT / f'public/textures/planets/{body}.jpg'
    with Image.open(texture) as image:
        if image.width != 2 * image.height:
            raise ValueError(f'{body}: expected a 2:1 equirectangular map')
    optimize_image(Image.open(texture), texture, 2048)
    doc, binary = read_glb(ROOT / f'public/models/celestial/{body}.glb')
    if not doc.get('images'):
        # Some original moons were plain-color spheres, but already have UVs.
        # Add only the missing image/material binding; preserve their geometry.
        primitive = doc['meshes'][0]['primitives'][0]
        assert 'TEXCOORD_0' in primitive['attributes'], f'{body}: missing surface UVs'
        doc['images'] = [{'bufferView': len(doc['bufferViews']), 'mimeType': 'image/jpeg'}]
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': 0})
        doc['textures'] = [{'source': 0}]
        material = doc['materials'][primitive['material']]['pbrMetallicRoughness']
        material['baseColorTexture'] = {'index': 0}
        material['baseColorFactor'] = [1, 1, 1, 1]
    image_view = doc['images'][0]['bufferView']
    chunks, offset = [], 0
    for index, view in enumerate(doc['bufferViews']):
        old_start = view.get('byteOffset', 0)
        chunk = texture.read_bytes() if index == image_view else binary[old_start:old_start + view['byteLength']]
        view['byteOffset'], view['byteLength'] = offset, len(chunk)
        chunk += b'\0' * (-len(chunk) % 4)
        chunks.append(chunk)
        offset += len(chunk)
    credit = CREDITS.get(body, 'NASA / JPL-Caltech')
    doc['asset']['copyright'] = f'Surface reference: {credit}. See docs/ASSETS.md. Geometry: OrbitWatch.'
    write_glb(ROOT / f'public/models/celestial/{body}.glb', doc, b''.join(chunks))
    print(body, texture.stat().st_size)
for name in ([] if sys.argv[1:] else ['iss', 'hubble']):
    path = ROOT / f'public/photos/{name}.jpg'
    optimize_image(Image.open(path), path, 640)
