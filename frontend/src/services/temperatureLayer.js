import { Credit, Rectangle, SingleTileImageryProvider } from 'cesium';
import { weatherPixels } from './weatherFields.js';
import { createWeatherPresentation } from './weatherPresentation.js';
import { prefersReducedMotion } from '../utils/motionPreferences.js';

export function temperatureProvider(field) {
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=360;
  const context=canvas.getContext('2d'),image=context.createImageData(720,360);
  image.data.set(weatherPixels(field));context.putImageData(image,0,0);
  return new SingleTileImageryProvider({url:canvas.toDataURL('image/png'),tileWidth:720,tileHeight:360,rectangle:Rectangle.MAX_VALUE,
    credit:new Credit('<a href="https://nomads.ncep.noaa.gov/">NOAA/NCEP GFS · model weather</a>')});
}

export function createTemperatureLayer(viewer,{makeProvider=temperatureProvider,now=()=>performance.now(),reduced=prefersReducedMotion}={}) {
  let layer=null,key=null,removeFrame=null,destroyed=false;
  const presentation=createWeatherPresentation(viewer.scene);
  function remove() {
    removeFrame?.();removeFrame=null;
    if(layer&&viewer.imageryLayers.contains(layer))viewer.imageryLayers.remove(layer,true);
    layer=null;key=null;
    presentation.set(false);
  }
  function fade(target) {
    removeFrame?.();removeFrame=null;
    if(!layer||!viewer.imageryLayers.contains(layer))return;
    const current=layer,start=now(),from=current.alpha;
    const tick=()=>{
      if(destroyed||viewer.isDestroyed()||!viewer.imageryLayers.contains(current)){removeFrame?.();removeFrame=null;return;}
      const progress=reduced()?1:Math.min(1,(now()-start)/350),ease=progress*progress*(3-2*progress);
      current.alpha=from+(target-from)*ease;
      presentation.set(current.alpha>0,target===0?1-ease:from===0?ease:1);
      if(progress>=1){removeFrame?.();removeFrame=null;if(target===0)remove();}
      else viewer.scene.requestRender();
    };
    removeFrame=viewer.scene.preRender.addEventListener(tick);viewer.scene.requestRender();
  }
  return {
    update({field,visible,opacity=.55,compatible=true,immediate=false}) {
      if(destroyed||viewer.isDestroyed())return;
      if(!visible||!field||!compatible){if(immediate||!compatible)remove();else fade(0);return;}
      if(!layer||!viewer.imageryLayers.contains(layer)||key!==field.id) {
        remove();layer=viewer.imageryLayers.addImageryProvider(makeProvider(field));key=field.id;
        layer.orbitwatchWeather=true;layer.alpha=0;
      }
      fade(Math.max(0,Math.min(.8,Number(opacity)||0)));
    },
    destroy(){if(destroyed)return;remove();destroyed=true;},
  };
}
