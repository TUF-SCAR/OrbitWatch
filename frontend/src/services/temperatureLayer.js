import { Credit, Rectangle, SingleTileImageryProvider, TextureMagnificationFilter, TextureMinificationFilter } from 'cesium';
import { weatherPixels } from './weatherFields.js';
import { createWeatherPresentation } from './weatherPresentation.js';
import { prefersReducedMotion } from '../utils/motionPreferences.js';

export function weatherTextureWidth(quality='auto',memory=globalThis.navigator?.deviceMemory??8){
  return quality==='performance'||quality==='auto'&&memory<=4?720:quality==='quality'?2160:1440;
}
export function temperatureProvider(field,quality,pixels) {
  const width=weatherTextureWidth(quality),height=width/2;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d'),image=context.createImageData(width,height);
  image.data.set(pixels||weatherPixels(field,width,height));context.putImageData(image,0,0);
  const provider=new SingleTileImageryProvider({url:canvas.toDataURL('image/png'),tileWidth:width,tileHeight:height,rectangle:Rectangle.MAX_VALUE,
    credit:new Credit(field.source_kind==='era5'?'<a href="https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels">Copernicus / ECMWF ERA5 · historical reanalysis</a>':'<a href="https://nomads.ncep.noaa.gov/">NOAA/NCEP GFS · model weather</a>')});
  canvas.width=canvas.height=0;
  return provider;
}

export function createTemperatureLayer(viewer,{compute,makeProvider=(field,quality)=>compute?compute.raster(field,weatherTextureWidth(quality),weatherTextureWidth(quality)/2).then(pixels=>temperatureProvider(field,quality,pixels)):temperatureProvider(field,quality),now=()=>performance.now(),reduced=prefersReducedMotion}={}) {
  let layer=null,key=null,removeFrame=null,destroyed=false,altitudeAlpha=1,baseAlpha=0,presentationStrength=1,generation=0,targetOpacity=.55;
  const presentation=createWeatherPresentation(viewer.scene);
  function applyAlpha(){if(layer){layer.alpha=baseAlpha*altitudeAlpha;presentation.set(layer.alpha>0,presentationStrength*altitudeAlpha);}}
  function remove() {
    generation++;
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
      if(!visible||!field||!compatible){if(immediate||!compatible||!layer)remove();else fade(0);return;}
      targetOpacity=Math.max(0,Math.min(.8,Number(opacity)||0));
      const nextKey=`${field.id}:${weatherTextureWidth(quality)}`;
      if(key!==nextKey||layer&&!viewer.imageryLayers.contains(layer)) {
        remove();key=nextKey;const token=generation;
        const install=provider=>{
          if(token!==generation||destroyed||viewer.isDestroyed())return;
          layer=viewer.imageryLayers.addImageryProvider(provider);
          layer.orbitwatchWeather=true;layer.alpha=0;
          layer.magnificationFilter=TextureMagnificationFilter.LINEAR;
          layer.minificationFilter=TextureMinificationFilter.LINEAR;fade(targetOpacity);
        };
        const provider=makeProvider(field,quality);
        if(provider?.then)provider.then(install).catch(error=>{if(token===generation){key=null;if(error.name!=='AbortError')console.error('Weather raster unavailable',error);}});
        else install(provider);
      }
      fade(targetOpacity);
    },
    destroy(){if(destroyed)return;remove();destroyed=true;},
  };
}
