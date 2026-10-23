import {JulianDate} from 'cesium';

// Readiness uses the existing scene, not a new Viewer or an artificial wait.
export async function prepareTimeScene(viewer,{time,signal,applyMap,earth,timeoutMs=12000}) {
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
      if(frames>=2 && (!earth || viewer.scene.globe.tilesLoaded)) finish();
      else viewer.scene.requestRender();
    });
    viewer.scene.requestRender();
  });
}
