import { Math as CesiumMath } from 'cesium';
import { createCloudLayer } from './cloudLayer.js';

// Quantized, padded coverage: small drags reuse a region; never request across
// the antimeridian or invent polar coverage. Global imagery remains the fallback.
export function cloudRegion(view,quality) {
  if(!view||quality==='performance')return null;
  const [w,s,e,n]=view;if(![w,s,e,n].every(Number.isFinite)||e<=w||n<=s||e-w>100||n-s>80||s< -75||n>75)return null;
  const span=Math.max(e-w,n-s),step=span>35?10:span>12?5:2;
  const bounds=[Math.max(-180,Math.floor(w/step)*step-step),Math.max(-80,Math.floor(s/step)*step-step),Math.min(180,Math.ceil(e/step)*step+step),Math.min(80,Math.ceil(n/step)*step+step)];
  const width=quality==='quality'?2048:1024;
  return {bounds,width,height:Math.max(128,Math.min(2048,Math.round(width*(bounds[3]-bounds[1])/(bounds[2]-bounds[0]))))};
}
export function createCloudDetail(viewer,options={}) {
  const owner=createCloudLayer(viewer,options);
  const doc=options.doc||(typeof document==='undefined'?null:document);
  let state={},controller=null,timer=null,regional=null,cachedRegion=null,key=null,pendingKey=null,destroyed=false,revision=0,error=null,lastRequest=-Infinity,altitudeAlpha=1;
  function paint(frame=state.frame){owner.update({...state,frame});}
  function cancel(){clearTimeout(timer);timer=null;controller?.abort();controller=null;pendingKey=null;revision++;}
  function viewBounds(){const r=viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);return r?[r.west,r.south,r.east,r.north].map(CesiumMath.toDegrees):null;}
  function covers(frame){const v=viewBounds(),b=frame.bounds;return v&&v[2]>v[0]&&v[0]>=b[0]&&v[1]>=b[1]&&v[2]<=b[2]&&v[3]<=b[3];}
  async function detail(){
    timer=null;if(destroyed||altitudeAlpha===0||doc?.hidden||!state.visible||!state.compatible||!state.ready||state.playing||!state.frame||!state.service)return;
    const region=cloudRegion(viewBounds(),state.quality);
    if(!region){regional=null;paint();return;}
    if(cachedRegion?.time===state.frame.time&&cachedRegion.width===region.width&&covers(cachedRegion)){regional=cachedRegion;paint(regional);return;}
    const next=`${state.frame.time}:${region.width}:${region.bounds}`;
    if(next===key&&regional){paint(regional);return;}
    if(next===pendingKey)return;
    if(pendingKey)cancel();
    // A flight/idle camera can emit multiple moveEnd events. Bound refinement
    // cadence in addition to the shared provider quota, keeping global visible.
    const remaining=10000-(performance.now()-lastRequest);
    if(remaining>0){timer=setTimeout(detail,remaining);return;}
    lastRequest=performance.now();
    const version=revision,base=state.frame;controller=new AbortController();pendingKey=next;
    try {
      const frame=await state.service.frame(base.time,{...region,frames:2},controller.signal);
      if(destroyed||version!==revision)return;
      cachedRegion=frame;key=next;error=null;
      if(covers(frame)){regional=frame;paint(frame);}
    }catch(e){if(!controller?.signal.aborted&&version===revision){error=e.message;paint();}}
    finally{if(version===revision){pendingKey=null;controller=null;}}
  }
  // Keep an in-flight same-view crop alive through Cesium's small reference-frame
  // camera events. Only a materially different region/time invalidates it.
  const start=()=>{clearTimeout(timer);timer=null;};
  const end=()=>{clearTimeout(timer);timer=setTimeout(detail,650);};
  const removeStart=viewer.camera.moveStart.addEventListener(start),removeEnd=viewer.camera.moveEnd.addEventListener(end);
  let checkedAt=0;
  const removeGuard=viewer.scene.preRender.addEventListener(()=>{
    if(!regional||performance.now()-checkedAt<200)return;checkedAt=performance.now();
    if(!covers(regional)){regional=null;paint();}
  });
  const visibility=()=>{if(doc.hidden)cancel();else if(state.visible)end();};
  doc?.addEventListener('visibilitychange',visibility);
  return {
    setAltitudeAlpha(value){
      if(value===altitudeAlpha)return;
      const wasHidden=altitudeAlpha===0;altitudeAlpha=value;owner.setAltitudeAlpha(value);
      if(value===0)cancel();else if(wasHidden&&state.visible)end();
    },
    update(next){
      const changed=next.frame?.id!==state.frame?.id||next.quality!==state.quality||next.visible!==state.visible||next.compatible!==state.compatible||next.playing!==state.playing||next.ready!==state.ready;
      state=next;
      if(changed){cancel();regional=null;cachedRegion=null;key=null;paint();if(next.visible)end();}
      else paint(regional||next.frame);
    },
    diagnostics:()=>({...owner.diagnostics(),regional:Boolean(regional),detailError:error,requests:state.service?.diagnostics().requests}),
    destroy(){if(destroyed)return;destroyed=true;cancel();removeStart();removeEnd();removeGuard();doc?.removeEventListener('visibilitychange',visibility);owner.destroy();},
  };
}
