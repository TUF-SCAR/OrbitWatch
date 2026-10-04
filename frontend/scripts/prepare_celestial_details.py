"""Add small schematic ring meshes and an emissive Sun to existing GLBs.
Idempotent: previous generated ring buffers are removed before rebuilding.
"""
import json
import math
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'public/models/celestial'

def load(path):
    raw = path.read_bytes()
    n = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20+n]), raw[28+n:]

def save(path, doc, binary):
    doc['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, 28+len(encoded)+len(binary)) + struct.pack('<II',len(encoded),0x4E4F534A) + encoded + struct.pack('<II',len(binary),0x004E4942) + binary)

def region(inner, outer, color, opacities):
    step = (outer-inner)/len(opacities)
    return [(inner+i*step, inner+(i+1)*step, [*color, opacity]) for i, opacity in enumerate(opacities)]

RINGS = {
    # Radii relative to the catalog mean radius. C/B/A boundaries follow NASA's
    # ring fact sheet; brightness is schematic, not a measured optical-depth map.
    'saturn': (region(1.28, 1.58, [.55,.51,.43], [.16,.20,.18,.24])
               + region(1.58, 2.02, [.78,.72,.60], [.60,.64,.69,.63,.70,.67,.75,.74])
               + [(2.02,2.10,[.55,.51,.43,.035])]
               + region(2.10, 2.35, [.70,.66,.57], [.48,.52,.46,.50,.44])),
    'jupiter': [(1.65,2.20,[.60,.51,.43,.09])],
    'uranus': [(r,r+.015,[.59,.66,.69,.42]) for r in [1.62,1.82,2.02]],
    'neptune': [(r,r+.013,[.48,.54,.64,.30]) for r in [1.62,2.10,2.54]],
    # Ortiz et al. (2017): approximate radius 2,287 km, width 70 km.
    'haumea': [((2287-35)/780,(2287+35)/780,[.70,.73,.74,.50])],
}
selected = set(sys.argv[1:]) if len(sys.argv) > 1 else {*RINGS, 'sun'}
assert selected <= {*RINGS, 'sun'}, 'Unknown body requested'
for body, bands in RINGS.items():
    if body not in selected:
        continue
    path = ROOT / f'{body}.glb'
    doc, binary = load(path)
    old = doc.get('extras',{}).get('orbitwatchRings')
    if old:
        doc['bufferViews'] = doc['bufferViews'][:old['views']]
        doc['accessors'] = doc['accessors'][:old['accessors']]
        doc['materials'] = doc['materials'][:old['materials']]
        doc['meshes'][0]['primitives'] = doc['meshes'][0]['primitives'][:old['primitives']]
        end = max(v.get('byteOffset',0)+v['byteLength'] for v in doc['bufferViews'])
        binary = binary[:end]
    doc.setdefault('extras',{})['orbitwatchRings'] = {'views':len(doc['bufferViews']),'accessors':len(doc['accessors']),'materials':len(doc['materials']),'primitives':len(doc['meshes'][0]['primitives'])}
    def attribute(values, count, kind, component, fmt, bounds=None):
        global binary
        binary += b'\0' * (-len(binary) % 4)
        chunk = struct.pack('<'+fmt*len(values),*values)
        view = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(chunk)})
        binary += chunk
        accessor = {'bufferView':view,'componentType':component,'count':count,'type':kind}
        if bounds: accessor.update(min=bounds[0],max=bounds[1])
        doc['accessors'].append(accessor)
        return len(doc['accessors'])-1
    # Combine bands into one primitive/draw call with vertex colors. Contiguous
    # bands avoid the artificial dark slots in the old equal-width ring mesh.
    positions, normals, colors, indices = [], [], [], []
    segments = 192
    for inner, outer, color in bands:
        first = len(positions)//3
        for k in range(segments+1):
            a = k/segments*math.tau
            for r in [inner,outer]: positions += [r*math.cos(a),0,r*math.sin(a)]; normals += [0,1,0]
            colors += color*2
        for k in range(segments):
            i = first+k*2
            indices += [i,i+2,i+1,i+1,i+2,i+3]
    count = len(positions)//3
    assert count < 65536
    outer = max(band[1] for band in bands)
    p = attribute(positions,count,'VEC3',5126,'f',([-outer,0,-outer],[outer,0,outer]))
    n = attribute(normals,count,'VEC3',5126,'f')
    c = attribute(colors,count,'VEC4',5126,'f')
    ix = attribute(indices,len(indices),'SCALAR',5123,'H')
    material = len(doc['materials'])
    doc['materials'].append({'name':'Schematic ring system','doubleSided':True,'alphaMode':'BLEND','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0,'roughnessFactor':1}})
    doc['meshes'][0]['primitives'].append({'attributes':{'POSITION':p,'NORMAL':n,'COLOR_0':c},'indices':ix,'material':material})
    save(path,doc,binary)
    print(body,'ring bands',len(bands))
if 'sun' in selected:
    path = ROOT / 'sun.glb'
    doc,binary = load(path)
    doc['extensionsUsed'] = sorted(set(doc.get('extensionsUsed',[])+['KHR_materials_unlit']))
    material = doc['materials'][0]
    material['extensions'] = {'KHR_materials_unlit':{}}
    material['emissiveFactor'] = [1,.52,.12]
    save(path,doc,binary)
