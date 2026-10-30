import {useEffect,useMemo,useRef,useState} from 'react';
import {fetchHistoricalTrajectories} from './orbitwatchApi.js';
import {timeSatelliteSelection} from '../data/timeExplorerCatalog.js';

export function useHistoricalSatellites(enabled,ids,time,retry) {
  const timestamp=time.toISOString(),idKey=timeSatelliteSelection(ids).sort((a,b)=>a-b).join(',');
  const cache=useRef(null),[state,setState]=useState({state:'idle',objects:[],errors:[]});
  useEffect(()=>{
    if(!enabled)return undefined;
    const controller=new AbortController(),key=`${timestamp}:${idKey}:${retry}`;
    if(cache.current?.key===key) {setState(cache.current.value);return ()=>controller.abort();}
    if(!idKey) {setState({state:'ready',timestamp,objects:[],errors:[]});return ()=>controller.abort();}
    setState({state:'loading',timestamp,objects:[],errors:[]});
    fetchHistoricalTrajectories(idKey.split(',').map(Number),timestamp,{signal:controller.signal}).then(result=>{
      if(controller.signal.aborted)return;
      if(!Array.isArray(result.objects) || !Array.isArray(result.errors))throw new Error('Historical response is invalid');
      if(result.requested_timestamp && Date.parse(result.requested_timestamp)!==Date.parse(timestamp))throw new Error('Historical response timestamp differs from the requested scene');
      const value={...result,state:'ready',timestamp};cache.current={key,value};setState(value);
    }).catch(error=>{if(!controller.signal.aborted)setState({state:'unavailable',timestamp,objects:[],errors:[],message:error.message});});
    return ()=>controller.abort();
  },[enabled,timestamp,idKey,retry]);
  return useMemo(()=>enabled && state.timestamp!==timestamp ? {state:'loading',timestamp,objects:[],errors:[]} : state,[enabled,state,timestamp]);
}
