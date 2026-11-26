import {useEffect,useMemo,useState} from 'react';
import {fetchHistoricalWeatherCoverage,fetchHistoricalWeatherSnapshot,fetchHistoricalWeatherLocation} from '../services/orbitwatchApi.js';
import {nearestWeatherMetadata,historicalField,validateHistoricalSnapshot} from '../services/historicalWeather.js';

const COVERAGE_REFRESH_MS=120_000;

export function useHistoricalWeather(active,time){
  const sceneStamp=time.getTime();
  const [coverage,setCoverage]=useState(null),[coverageError,setCoverageError]=useState('');
  const [enabled,setEnabled]=useState(true),[windEnabled,setWindEnabled]=useState(false);
  const [variable,setVariable]=useState('temperature'),[opacity,setOpacity]=useState(.55);
  const [stored,setStored]=useState(null),[failure,setFailure]=useState(null);
  const [selectionState,setSelection]=useState(null),[location,setLocation]=useState(null);
  const metadata=useMemo(()=>nearestWeatherMetadata(coverage,sceneStamp),[coverage,sceneStamp]);
  const sourceStamp=metadata?Date.parse(metadata.timestamp):null;
  const sourceHash=metadata?.sha256;
  const sourceKey=metadata?`${sourceStamp}:${sourceHash}`:null;
  const cacheHit=sourceKey!==null&&stored?.key===sourceKey;
  const isNearest=sourceStamp!==null&&sourceStamp!==sceneStamp;

  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();
    let timer;
    async function refresh(){
      try {
        const value=await fetchHistoricalWeatherCoverage(controller.signal);
        if(!controller.signal.aborted){setCoverage(value);setCoverageError('');}
      }catch{
        if(!controller.signal.aborted)setCoverageError('Archive index could not be refreshed. OrbitWatch will retry.');
      }finally{
        if(!controller.signal.aborted)timer=setTimeout(refresh,COVERAGE_REFRESH_MS);
      }
    }
    refresh();
    return()=>{controller.abort();clearTimeout(timer);};
  },[active]);

  useEffect(()=>{
    if(!active||!enabled||!sourceKey||cacheHit)return;
    const controller=new AbortController();
    const sourceTime=new Date(sourceStamp);
    fetchHistoricalWeatherSnapshot(sourceTime,controller.signal).then(value=>{
      if(controller.signal.aborted)return;
      validateHistoricalSnapshot(value,sourceTime,sourceHash);
      setStored({key:sourceKey,value});setFailure(null);
    }).catch(()=>{
      if(!controller.signal.aborted)setFailure({key:sourceKey,message:'Stored snapshot could not be verified or loaded. Toggle weather to retry.'});
    });
    return()=>controller.abort();
  },[active,enabled,sourceKey,sourceStamp,sourceHash,cacheHit]);

  // Fence render data synchronously, including before cancellation effects run.
  const snapshot=active&&enabled&&cacheHit?stored.value:null;
  const selection=snapshot&&selectionState?.stamp===sceneStamp?selectionState.point:null;
  useEffect(()=>{
    if(!selection)return;
    const controller=new AbortController();
    fetchHistoricalWeatherLocation(new Date(sourceStamp),selection,controller.signal).then(value=>{
      if(controller.signal.aborted)return;
      if(value.source!=='ERA5 reanalysis'||Date.parse(value.timestamp)!==sourceStamp
        ||value.latitude!==selection.latitude||value.longitude!==selection.longitude)throw Error('Mismatched historical location');
      setLocation({key:sourceKey,point:selection,data:value});
    }).catch(()=>{
      if(!controller.signal.aborted)setLocation({key:sourceKey,point:selection,error:true});
    });
    return()=>controller.abort();
  },[selection,sourceKey,sourceStamp]);

  const field=useMemo(()=>historicalField(snapshot,variable),[snapshot,variable]);
  const wind=useMemo(()=>historicalField(snapshot,'wind'),[snapshot]);
  function select(point){
    setLocation(null);
    setSelection(point?{stamp:sceneStamp,point:{...point}}:null);
  }
  function changeEnabled(value){
    if(!value){select(null);setFailure(null);}
    setEnabled(value);
  }
  return {coverage,coverageError,metadata,isNearest,sourceStamp,enabled,setEnabled:changeEnabled,windEnabled,setWindEnabled,variable,setVariable,opacity,setOpacity,
    field,wind,snapshot,error:failure?.key===sourceKey?failure.message:'',
    selection,select,location:selection&&location?.key===sourceKey&&location.point===selection?location:null};
}
