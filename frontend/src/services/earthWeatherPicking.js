import {Math as CesiumMath} from 'cesium';

export function pickEarthLocation(viewer,position,tileset=null) {
  const {scene,camera}=viewer;
  let point;
  // Only a picked tile from the current Earth tileset may supply depth. A
  // satellite, marker, label or orbit must never supply a surface coordinate.
  if(tileset?.show&&scene.pickPositionSupported) {
    const picked=scene.pick(position);
    if(picked?.tileset===tileset||picked?.primitive===tileset||picked?.content?.tileset===tileset) {
      try {point=scene.pickPosition(position);} catch { /* Fall back to terrain. */ }
      if(point){const coordinate=scene.globe.ellipsoid.cartesianToCartographic(point);if(!coordinate||coordinate.height < -15000||coordinate.height>15000)point=null;}
    }
  }
  if(!point) {
    const ray=camera.getPickRay(position);
    if(ray)point=scene.globe.pick(ray,scene);
    if(!point)point=camera.pickEllipsoid(position,scene.globe.ellipsoid);
  }
  if(!point)return null;
  const coordinate=scene.globe.ellipsoid.cartesianToCartographic(point);
  // globe.pick is authoritative for terrain, including bathymetry and the
  // ellipsoid chord error of coarse wide-view meshes. Height is not a useful
  // physical rejection threshold for this trusted surface ray intersection.
  if(!coordinate||!Number.isFinite(coordinate.height))return null;
  const latitude=CesiumMath.toDegrees(coordinate.latitude),longitude=CesiumMath.toDegrees(coordinate.longitude);
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90 ? {latitude,longitude,height:coordinate.height} : null;
}

export function createSurfaceClickGate({onSelect,eligible,now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout,delay=350}) {
  let timer=null,last=null,committed=false;
  function stop(reset=false) {cancel(timer);timer=null;if(reset){last=null;committed=false;}}
  function doubleClick() {stop();if(committed)onSelect(null);last=null;committed=false;}
  return {
    click(position,location) {
      const stamp=now();
      if(last&&stamp-last.stamp<=delay&&Math.hypot(position.x-last.x,position.y-last.y)<18){doubleClick();return;}
      stop();last={x:position.x,y:position.y,stamp};committed=false;
      timer=schedule(()=>{timer=null;if(eligible()){committed=true;onSelect(location);}},delay);
    },
    cancel:stop,doubleClick,destroy(){stop(true);},
  };
}

// Called only by the existing Cesium LEFT_CLICK handler, after gesture checks.
export function routeEarthWeatherClick(position,{eventPick,pickObject,onCelestial,onSatellite,atEarth,following=false,eligible,snap,pickSurface,onLocation,gate}) {
  if(eventPick()) {gate.cancel(true);onLocation(null);return 'event';}
  const picked=pickObject(),celestial=picked?.id?.properties?.celestialId?.getValue?.();
  if(celestial) {gate.cancel(true);onLocation(null);onCelestial(String(celestial));return 'celestial';}
  const norad=picked?.id?.properties?.noradId?.getValue?.();
  if(norad&&atEarth) {gate.cancel(true);onLocation(null);onSatellite(Number(norad));return 'satellite';}
  if(atEarth&&!following)onSatellite(null);
  if(!eligible())return 'ineligible';
  const location=snap(position)||pickSurface(position);
  if(!location){gate.cancel(true);onLocation(null);return 'empty';}
  gate.click(position,location);return 'surface';
}
