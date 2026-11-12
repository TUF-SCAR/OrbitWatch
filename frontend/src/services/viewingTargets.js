import {fetchViewingTargets} from './orbitwatchApi.js';
// Per mounted authenticated view; no persistence of personal locations.
export function createViewingTargets(transport=fetchViewingTargets){
  let controller=null,revision=0;
  return {async load(kind,notify){controller?.abort();const current=++revision;controller=new AbortController();let offset=0,items=[];notify({phase:'loading',items,error:''});
    try{for(let page=0;page<64&&offset!==null;page++){
      const result=await transport(kind,offset,controller.signal);if(controller.signal.aborted||current!==revision)return;
      if(!Array.isArray(result.items)||result.items.length>4)throw Error('Invalid target planning response');
      items=[...items,...result.items];notify({phase:result.next_offset===null?'ready':'loading',items,error:''});
      if(result.next_offset!==null&&(!Number.isInteger(result.next_offset)||result.next_offset<=offset))throw Error('Invalid target planning cursor');offset=result.next_offset;
    }}catch(error){if(current===revision&&!controller.signal.aborted)notify({phase:'error',items,error:error.message});}},cancel(){revision++;controller?.abort();}};
}
