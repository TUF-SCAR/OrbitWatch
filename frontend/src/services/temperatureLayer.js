import { Credit, Rectangle, SingleTileImageryProvider } from 'cesium';
import { rainBudget } from './precipitationStyle.js';
import { weatherPixels } from './weatherFields.js';
import { createWeatherPresentation } from './weatherPresentation.js';
import { prefersReducedMotion } from '../utils/motionPreferences.js';

export function temperatureProvider(field,quality) {
  const width=field.display_variable==='precipitation'?rainBudget(quality).width:720,height=width/2;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d'),image=context.createImageData(width,height);
  image.data.set(weatherPixels(field,width,height));context.putImageData(image,0,0);
  return new SingleTileImageryProvider({url:canvas.toDataURL('image/png'),tileWidth:width,tileHeight:height,rectangle:Rectangle.MAX_VALUE,
    credit:new Credit('<a href="https://nomads.ncep.noaa.gov/">NOAA/NCEP GFS · model weather</a>')});
}

export function createTemperatureLayer(viewer,{makeProvider=temperatureProvider,now=()=>performance.now(),reduced=prefersReducedMotion}={}) {
  let layer=null,key=null,removeFrame=null,destroyed=false,altitudeAlpha=1,baseAlpha=0,presentationStrength=1;
  const presentation=createWeatherPresentation(viewer.scene);
  function applyAlpha(){if(layer){layer.alpha=baseAlpha*altitudeAlpha;presentation.set(layer.alpha>0,presentationStrength*altitudeAlpha);}}
  function remove() {
    removeFrame?.();removeFrame=null;
    if(layer&&viewer.imageryLayers.contains(layer))viewer.imageryLayers.remove(layer,true);
    layer=null;key=null;baseAlpha=0;
    presentation.set(false);
  }
  function fade(target) {
    removeFrame?.();removeFrame=null;
    if(!layer||!viewer.imageryLayers.contains(layer))return;
    const current=layer,start=now(),from=baseAlpha;
    const tick=()=>{
      if(destroyed||viewer.isDestroyed()||!viewer.imageryLayers.contains(current)){removeFrame?.();removeFrame=null;return;}
      const progress=reduced()?1:Math.min(1,(now()-start)/350),ease=progress*progress*(3-2*progress);
      baseAlpha=from+(target-from)*ease;
      presentationStrength=target===0?1-ease:from===0?ease:1;applyAlpha();
      if(progress>=1){removeFrame?.();removeFrame=null;if(target===0)remove();}
      else viewer.scene.requestRender();
    };
    removeFrame=viewer.scene.preRender.addEventListener(tick);viewer.scene.requestRender();
  }
  return {
    setAltitudeAlpha(value){if(value===altitudeAlpha)return;altitudeAlpha=value;applyAlpha();},
    update({field,visible,opacity=.55,compatible=true,immediate=false,quality='auto'}) {
      if(destroyed||viewer.isDestroyed())return;
      if(!visible||!field||!compatible){if(immediate||!compatible)remove();else fade(0);return;}
      const nextKey=field.display_variable==='precipitation'?`${field.id}:${quality}`:field.id;
      if(!layer||!viewer.imageryLayers.contains(layer)||key!==nextKey) {
        remove();layer=viewer.imageryLayers.addImageryProvider(makeProvider(field,quality));key=nextKey;
        layer.orbitwatchWeather=true;layer.alpha=0;
      }
      fade(Math.max(0,Math.min(.8,Number(opacity)||0)));
    },
    destroy(){if(destroyed)return;remove();destroyed=true;},
  };
}
