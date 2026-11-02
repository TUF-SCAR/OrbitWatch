import {fetchVisibilityPreview} from './orbitwatchApi.js';

// One mounted account view owns this controller. A location/target change aborts
// its predecessor; sequence validation also rejects transports that ignore abort.
export function createVisibilityPreview(transport=fetchVisibilityPreview) {
  let controller=null,sequence=0,dead=false;
  return {
    async load(kind,locationId,targetIds,notify) {
      controller?.abort();controller=new AbortController();const current=++sequence;
      notify({phase:'loading',data:null,error:''});
      try {
        const data=await transport(kind,locationId,controller.signal);
        if(!dead&&current===sequence)notify({phase:'ready',data:{...data,items:data.items.filter(item=>targetIds.includes(item.target_id))},error:''});
      }catch(error){if(!dead&&current===sequence&&!controller.signal.aborted)notify({phase:'error',data:null,error:error.message});}
    },
    cancel(){sequence++;controller?.abort();},
    destroy(){dead=true;sequence++;controller?.abort();},
  };
}
