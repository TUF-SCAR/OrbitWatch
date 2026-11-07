// A single viewer-owned worker. At most one running and one queued job per
// kind; rapid field changes replace queued work instead of growing a backlog.
export function createWeatherCompute({makeWorker=()=>new Worker(new URL('./weatherWorker.js',import.meta.url),{type:'module'})}={}){
  let worker=null,running=null,serial=0,destroyed=false;const queued=new Map();
  const aborted=()=>new DOMException('Weather computation superseded','AbortError');
  function dispatch(){
    if(running||destroyed||!queued.size)return;
    const [kind,job]=queued.entries().next().value;queued.delete(kind);running=job;
    worker.postMessage({id:job.id,kind,field:job.field,width:job.width,height:job.height});
  }
  function submit(kind,field,width,height){
    if(destroyed)return Promise.reject(aborted());
    if(!worker){
      try{worker=makeWorker();}catch(error){return Promise.reject(error);}
      worker.onmessage=({data})=>{
        if(!running||data.id!==running.id)return;
        if(data.error)running.reject(Error(data.error));else running.resolve(data.result);
        running=null;dispatch();
      };
      worker.onerror=()=>{running?.reject(Error('Weather worker failed'));running=null;for(const job of queued.values())job.reject(Error('Weather worker failed'));queued.clear();worker.terminate();worker=null;};
    }
    // Copy only the selected scientific plane, not every field in its bundle.
    const {grid,display_variable,source_kind,valid_at,units,step_type,source_units,grib_parameter,level,values,values_c,u,v}=field;
    const plane={grid,display_variable,source_kind,valid_at,units,step_type,source_units,grib_parameter,level,
      values,values_c:!display_variable||display_variable==='temperature'?values_c:undefined,u:display_variable==='wind'?u:undefined,v:display_variable==='wind'?v:undefined,
      precipitation_clouds:display_variable==='precipitation'?field.fields?.clouds:undefined};
    return new Promise((resolve,reject)=>{
      queued.get(kind)?.reject(aborted());queued.set(kind,{id:++serial,field:plane,width,height,resolve,reject});dispatch();
    });
  }
  return {raster:(field,width,height)=>submit('raster',field,width,height),pressure:field=>submit('pressure',field),
    destroy(){if(destroyed)return;destroyed=true;worker?.terminate();worker=null;running?.reject(aborted());running=null;for(const job of queued.values())job.reject(aborted());queued.clear();},
  };
}
