import {ClockStep,JulianDate} from 'cesium';

export function updateSceneTime(viewer,time,mode,frameRate) {
  if(mode==='time') {
    viewer.clock.currentTime=JulianDate.fromDate(time);
    viewer.clock.shouldAnimate=false;
    viewer.scene.maximumRenderTimeChange=Number.POSITIVE_INFINITY;
  } else {
    viewer.clock.currentTime=JulianDate.now();
    viewer.clock.shouldAnimate=mode==='live';
    if(mode==='live') viewer.clock.clockStep=ClockStep.SYSTEM_CLOCK;
    viewer.scene.maximumRenderTimeChange=mode==='live' ? 1/frameRate : Number.POSITIVE_INFINITY;
  }
  viewer.scene.requestRender();
}

// Readiness uses the existing scene, not a new Viewer or an artificial wait.
export async function prepareTimeScene(viewer,{time,signal,applyMap,earth,waitForTiles=true,timeoutMs=12000}) {
  if(signal.aborted || viewer.isDestroyed()) throw new DOMException('Cancelled','AbortError');
  if(earth) await applyMap();
  if(signal.aborted || viewer.isDestroyed()) throw new DOMException('Cancelled','AbortError');
  const target=JulianDate.fromDate(time);
  return new Promise((resolve,reject)=>{
    let remove,frames=0;
    const finish=error=>{clearTimeout(timer);remove?.();signal.removeEventListener('abort',abort);error ? reject(error) : resolve();};
    const abort=()=>finish(new DOMException('Cancelled','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Scene readiness timed out; imagery may be incomplete.')),timeoutMs);
    signal.addEventListener('abort',abort,{once:true});
    remove=viewer.scene.postRender.addEventListener((_scene,stamp)=>{
      if(!JulianDate.equals(stamp,target)) return;
      frames++;
      if(frames>=2 && (!earth || !waitForTiles || viewer.scene.globe.tilesLoaded)) finish();
      else viewer.scene.requestRender();
    });
    viewer.scene.requestRender();
  });
}
