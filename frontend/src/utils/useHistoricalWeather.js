import {useEffect,useMemo,useState} from 'react';
import {fetchHistoricalWeatherCoverage,fetchHistoricalWeatherSnapshot,fetchHistoricalWeatherLocation} from '../services/orbitwatchApi.js';
import {exactWeatherMetadata,nearestWeatherMetadata,historicalField,validateHistoricalSnapshot} from '../services/historicalWeather.js';

export function useHistoricalWeather(active,time){
  const stamp=time.getTime();
  const [coverage,setCoverage]=useState(null),[coverageError,setCoverageError]=useState('');
  const [enabled,setEnabled]=useState(false),[windEnabled,setWindEnabled]=useState(false);
  const [variable,setVariable]=useState('temperature'),[opacity,setOpacity]=useState(.55);
  const [stored,setStored]=useState(null),[failure,setFailure]=useState(null);
  const [selectionState,setSelection]=useState(null),[location,setLocation]=useState(null);
  const metadata=exactWeatherMetadata(coverage,time),nearest=nearestWeatherMetadata(coverage,time);
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();
    fetchHistoricalWeatherCoverage(controller.signal).then(value=>{if(!controller.signal.aborted){setCoverage(value);setCoverageError('');}})
      .catch(()=>{if(!controller.signal.aborted)setCoverageError('Archive index unavailable. Try reopening Time Explorer.');});
    return()=>controller.abort();
  },[active]);
  useEffect(()=>{
    if(!active||!enabled||!metadata)return;
    const controller=new AbortController();
    fetchHistoricalWeatherSnapshot(new Date(stamp),controller.signal).then(value=>{
      validateHistoricalSnapshot(value,new Date(stamp));
      if(!controller.signal.aborted){setStored(value);setFailure(null);}
    }).catch(()=>{if(!controller.signal.aborted)setFailure({stamp,message:'Stored snapshot could not be verified or loaded. Toggle weather to retry.'});});
    return()=>controller.abort();
  },[active,enabled,metadata,stamp]);
  // Synchronous fence: old planes never reach Cesium even before effects clean up.
  const snapshot=active&&enabled&&Date.parse(stored?.timestamp)===stamp?stored:null;
  const selection=active&&selectionState?.stamp===stamp?selectionState.point:null;
  useEffect(()=>{
    if(!active||!selection||!metadata)return;
    const controller=new AbortController();
    fetchHistoricalWeatherLocation(new Date(stamp),selection,controller.signal).then(value=>{
      if(!controller.signal.aborted&&Date.parse(value.timestamp)===stamp)setLocation({stamp,point:selection,data:value});
    }).catch(()=>{if(!controller.signal.aborted)setLocation({stamp,point:selection,error:true});});
    return()=>controller.abort();
  },[active,selection,metadata,stamp]);
  const field=useMemo(()=>historicalField(snapshot,variable),[snapshot,variable]);
  const wind=useMemo(()=>historicalField(snapshot,'wind'),[snapshot]);
  function reset(){setEnabled(false);setWindEnabled(false);setStored(null);setFailure(null);setSelection(null);setLocation(null);}
  return {coverage,coverageError,metadata,nearest,enabled,setEnabled,windEnabled,setWindEnabled,variable,setVariable,opacity,setOpacity,
    field,wind,snapshot,error:failure?.stamp===stamp?failure.message:'',
    selection,select:point=>{setLocation(null);setSelection(point?{stamp,point}:null);},
    location:selection&&location?.stamp===stamp&&location?.point===selection?location:null,reset};
}
