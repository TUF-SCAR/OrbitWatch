import {weatherPixels} from './weatherFields.js';
import {pressureContours,pressureExtrema} from './pressureContours.js';

self.onmessage=({data})=>{
  const {id,kind,field,width,height}=data;
  try{
    if(kind==='raster'){
      const pixels=weatherPixels(field,width,height);self.postMessage({id,result:pixels},[pixels.buffer]);
    }else self.postMessage({id,result:{contours:pressureContours(field),extrema:pressureExtrema(field)}});
  }catch(error){self.postMessage({id,error:error.message});}
};
