"""Conservative polygon proximity; no invented centres or hazard radii.

Coordinates unwrap across the dateline. Ambiguous hemispheric/polar, crossing,
oversized or malformed rings are rejected. Distances use shortest spherical
great-circle boundary segments, not distance to an arbitrary boundary vertex.
"""
from functools import lru_cache
import json
import math

R=6371.0088


def distance(lat1,lon1,lat2,lon2):
    a,b=math.radians(lat1),math.radians(lat2)
    h=math.sin((b-a)/2)**2+math.cos(a)*math.cos(b)*math.sin(math.radians(lon2-lon1)/2)**2
    return R*2*math.asin(math.sqrt(min(1,max(0,h))))


def unwrap(ring):
    out=[ring[0]]
    for lon,lat in ring[1:]:out.append([out[-1][0]+(lon-out[-1][0]+180)%360-180,lat])
    return out


def inside(lon,lat,ring):
    lon=ring[0][0]+(lon-ring[0][0]+180)%360-180
    hit=False
    for (x1,y1),(x2,y2) in zip(ring,ring[1:]):
        if (y1>lat)!=(y2>lat) and lon<(x2-x1)*(lat-y1)/(y2-y1)+x1:hit=not hit
    return hit


def orientation(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


def intersect(a,b,c,d):
    if max(a[0],b[0])<min(c[0],d[0]) or max(c[0],d[0])<min(a[0],b[0]) or max(a[1],b[1])<min(c[1],d[1]) or max(c[1],d[1])<min(a[1],b[1]):return False
    return orientation(a,b,c)*orientation(a,b,d)<=0 and orientation(c,d,a)*orientation(c,d,b)<=0


@lru_cache(maxsize=128)
def validated_polygons(encoded):
    g=json.loads(encoded);polygons=[g['coordinates']] if g['type']=='Polygon' else g['coordinates'] if g['type']=='MultiPolygon' else []
    if not polygons or len(polygons)>32:raise ValueError('Unsupported polygon')
    result=[];total=0
    for polygon in polygons:
        if not polygon or len(polygon)>32:raise ValueError('Unsupported rings')
        rings=[]
        for raw in polygon:
            total+=len(raw)
            if not 4<=len(raw)<=512 or total>2048 or raw[0]!=raw[-1]:raise ValueError('Invalid ring')
            if any(len(p)!=2 or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in p) or abs(p[0])>180 or abs(p[1])>=85 for p in raw):raise ValueError('Ambiguous coordinates')
            ring=unwrap(raw)
            if abs(ring[-1][0]-ring[0][0])>1e-5 or max(p[0] for p in ring)-min(p[0] for p in ring)>=180:raise ValueError('Ambiguous hemisphere')
            if abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:])))<1e-8:raise ValueError('Degenerate ring')
            for i,(a,b) in enumerate(zip(ring,ring[1:])):
                if distance(a[1],a[0],b[1],b[0])>2200 or a==b:raise ValueError('Ambiguous segment')
                for j in range(i+2,len(ring)-1):
                    if i==0 and j==len(ring)-2:continue
                    if intersect(a,b,ring[j],ring[j+1]):raise ValueError('Crossing ring')
            if rings:
                shift=360*round((rings[0][0][0]-ring[0][0])/360)
                ring=[[x+shift,y] for x,y in ring]
                if not all(inside(x,y,rings[0]) for x,y in ring[:-1]):raise ValueError('Hole outside shell')
                for previous in rings:
                    if any(intersect(a,b,c,d) for a,b in zip(ring,ring[1:]) for c,d in zip(previous,previous[1:])):raise ValueError('Crossing holes')
                if any(inside(ring[0][0],ring[0][1],h) or inside(h[0][0],h[0][1],ring) for h in rings[1:]):raise ValueError('Overlapping holes')
            rings.append(ring)
        result.append(rings)
    return result


def bearing(a,b):
    lon1,lat1=map(math.radians,a);lon2,lat2=map(math.radians,b)
    return math.atan2(math.sin(lon2-lon1)*math.cos(lat2),math.cos(lat1)*math.sin(lat2)-math.sin(lat1)*math.cos(lat2)*math.cos(lon2-lon1))


def segment_distance(lon,lat,a,b):
    d13=distance(a[1],a[0],lat,lon)/R;d12=distance(a[1],a[0],b[1],b[0])/R
    angle=bearing(a,[lon,lat])-bearing(a,b)
    along=math.atan2(math.sin(d13)*math.cos(angle),math.cos(d13))
    if 0<=along<=d12:return abs(math.asin(max(-1,min(1,math.sin(d13)*math.sin(angle)))))*R
    return min(distance(lat,lon,a[1],a[0]),distance(lat,lon,b[1],b[0]))


def proximity(geometry,latitude,longitude):
    if not isinstance(geometry,dict):return None
    if not all(math.isfinite(x) for x in (latitude,longitude)) or abs(latitude)>90 or abs(longitude)>180:return None
    try:
        if geometry.get('type')=='Point':
            lon,lat=geometry['coordinates']
            if not all(isinstance(x,(float,int)) and not isinstance(x,bool) and math.isfinite(x) for x in (lon,lat)) or abs(lon)>180 or abs(lat)>90:return None
            return distance(latitude,longitude,lat,lon)
        polygons=validated_polygons(json.dumps(geometry,separators=(',',':'),allow_nan=False))
        best=float('inf')
        for rings in polygons:
            if inside(longitude,latitude,rings[0]) and not any(inside(longitude,latitude,hole) for hole in rings[1:]):return 0.0
            best=min(best,*(segment_distance(longitude,latitude,a,b) for ring in rings for a,b in zip(ring,ring[1:])))
        return best
    except (ValueError,TypeError,KeyError,IndexError,OverflowError):return None
