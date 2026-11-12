import {createLiveEphemeris} from './liveEphemeris.js';
import {smallBodyStore} from './solarSystemData.js';
import {bodyPositionFixed,sampleBodyOrbitFixed} from '../data/solarSystemEphemeris.js';

export const liveEphemeris=createLiveEphemeris(()=>smallBodyStore.snapshot().items);
export function modeEphemeris(getMode,store=smallBodyStore,live=liveEphemeris){
  return {
    position:(id,time,result)=>getMode()==='live'?live.position(id,time,result):bodyPositionFixed(id,time,result),
    orbit:(id,time,steps)=>getMode()==='live'?live.orbit(id,time,steps):sampleBodyOrbitFixed(id,time,steps),
    revision:()=>`${getMode()}:${store.snapshot().revision}`,
    describe:(id,time)=>getMode()==='live'?live.describe(id,time):{source:'Historical catalog approximation'},
  };
}
export function bindLiveScience(viewer,layer,getMode,store=smallBodyStore){
  let release=null;
  const changed=()=>{if(!viewer.isDestroyed()){layer.updatePositions(true);viewer.scene.requestRender();}};
  return {sync(){if(getMode()==='live'&&!release)release=store.acquire(changed);else if(getMode()!=='live'&&release){release();release=null;}changed();},destroy(){release?.();release=null;}};
}
