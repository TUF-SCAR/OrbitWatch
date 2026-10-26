import { Credit, Rectangle, SingleTileImageryProvider } from 'cesium';
import { CLOUD_SOURCE, CLOUD_STYLE } from './cloudConfig.js';
import { prefersReducedMotion } from '../utils/motionPreferences.js';

export async function cloudProvider(frame) {
  return SingleTileImageryProvider.fromUrl(frame.url,{rectangle:Rectangle.MAX_VALUE,
    credit:new Credit(`<a href="${CLOUD_SOURCE.information}">${CLOUD_SOURCE.credit} · ${frame.time} · IR cloud emphasis</a>`)});
}
export function createCloudLayer(viewer,{makeProvider=cloudProvider,now=()=>performance.now(),reduced=prefersReducedMotion,onError=()=>{}}={}) {
  let current=null,previous=null,key=null,pendingKey=null,generation=0,removeFrame=null,destroyed=false,opacity=.55,error=null;
  const remove=layer=>{if(layer&&viewer.imageryLayers.contains(layer))viewer.imageryLayers.remove(layer,true);};
  function settle(){removeFrame?.();removeFrame=null;remove(previous);previous=null;if(current)current.alpha=opacity;}
  function clear(){generation++;pendingKey=null;settle();remove(current);current=null;key=null;viewer.scene.requestRender();}
  return {
    async update({frame,visible,compatible=true,alpha=.55}) {
      if(destroyed||viewer.isDestroyed())return;
      opacity=Math.max(0,Math.min(.8,Number(alpha)||0));
      if(!visible||!compatible||!frame){clear();return;}
      if(key===frame.id||pendingKey===frame.id){if(current&&!removeFrame)current.alpha=opacity;viewer.scene.requestRender();return;}
      const version=++generation;pendingKey=frame.id;
      // Decode before replacing the current layer; network gaps never blank it.
      let provider;
      try{provider=await makeProvider(frame);}catch(e){if(version===generation){clear();error=e.message;onError(error);}return;}
      if(destroyed||viewer.isDestroyed()||version!==generation)return;
      pendingKey=null;error=null;settle();previous=current;
      current=viewer.imageryLayers.addImageryProvider(provider);current.orbitwatchWeather=true;
      current.alpha=0;key=frame.id;
      const start=now();
      const tick=()=>{
        const t=reduced()?1:Math.min(1,(now()-start)/CLOUD_STYLE.fadeMs);
        const ease=t*t*(3-2*t);current.alpha=opacity*ease;
        if(previous)previous.alpha=opacity*(1-ease);
        if(t===1)settle();else viewer.scene.requestRender();
      };
      removeFrame=viewer.scene.preRender.addEventListener(tick);viewer.scene.requestRender();
    },
    diagnostics:()=>({layers:Number(Boolean(current))+Number(Boolean(previous)),transitioning:Boolean(removeFrame),time:key,error}),
    destroy(){if(destroyed)return;clear();destroyed=true;},
  };
}
