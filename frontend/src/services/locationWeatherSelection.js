export const EMPTY_LOCATION_WEATHER=Object.freeze({selection:null,data:null,state:'idle',error:null});

export function createLocationWeatherSelection({fetchWeather,onChange,now=Date.now,schedule=setTimeout,cancel=clearTimeout,gate={nextRequestAt:0},debounce=250}) {
  let current=EMPTY_LOCATION_WEATHER,controller=null,timer=null,generation=0;
  function stop() {generation++;controller?.abort();controller=null;cancel(timer);timer=null;}
  function publish(value) {current=value;onChange({...value,clock:now()});}
  function clear() {stop();publish(EMPTY_LOCATION_WEATHER);}
  function select(selection) {
    if(!selection){clear();return;}
    if(!Number.isFinite(selection.latitude)||!Number.isFinite(selection.longitude)||Math.abs(selection.latitude)>90||Math.abs(selection.longitude)>180)return;
    stop();const token=generation;
    publish({selection,data:null,state:'loading',error:null,waitingUntil:gate.nextRequestAt>now()?gate.nextRequestAt:0});
    timer=schedule(async()=>{
      timer=null;const request=new AbortController();controller=request;
      publish({selection,data:null,state:'loading',error:null});
      gate.nextRequestAt=Math.max(gate.nextRequestAt,now()+2100);
      try {
        const data=await fetchWeather(selection.latitude,selection.longitude,request.signal);
        if(token!==generation||request.signal.aborted)return;
        const longitudeDelta=Math.abs(data.requested_longitude-selection.longitude);
        if(!data?.values||!Number.isFinite(Date.parse(data.valid_at))||!Number.isFinite(data.requested_latitude)||!Number.isFinite(longitudeDelta)||
            Math.abs(data.requested_latitude-selection.latitude)>.051||Math.min(longitudeDelta,360-longitudeDelta)>.051)throw Error('Location response does not match selection');
        publish({selection,data,state:'ready',error:null});
      } catch(error) {
        if(token!==generation||request.signal.aborted)return;
        if(error.retryAfterSeconds)gate.nextRequestAt=Math.max(gate.nextRequestAt,now()+error.retryAfterSeconds*1000);
        const message=error.kind==='offline'?'Weather is offline. Check your connection and retry.':error.kind==='timeout'?'The weather request timed out. Please retry.':'Weather is unavailable for this location. Please retry shortly.';
        publish({selection,data:null,state:'unavailable',error:message,retryAt:gate.nextRequestAt});
      } finally {if(controller===request)controller=null;}
    },Math.max(debounce,gate.nextRequestAt-now()));
  }
  return {select,clear,retry(){if(current.selection&&now()>=gate.nextRequestAt)select(current.selection);},destroy(){stop();}};
}
