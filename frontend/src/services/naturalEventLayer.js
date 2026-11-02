import { Cartesian2, Cartesian3, Color, CustomDataSource, NearFarScalar, VerticalOrigin,PolylineDashMaterialProperty,PolylineGlowMaterialProperty,ArcType,BoundingSphere,Matrix4,HeadingPitchRange } from 'cesium';
import {trackPoints,trackSegments,datedPointSubset,windColor} from './cycloneTracks.js';
import { prefersReducedMotion } from '../utils/motionPreferences.js';

import {EVENT_CATEGORIES} from '../data/eventCategories.js';
export {EVENT_CATEGORIES} from '../data/eventCategories.js';

const icons=new Map();
const clusterIcons=new Map();
export function clusterIcon(count){
  if(clusterIcons.has(count))return clusterIcons.get(count);
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d');
  c.fillStyle='#132c3e';c.strokeStyle='#6aaec0';c.lineWidth=2;c.beginPath();c.arc(32,32,28,0,Math.PI*2);c.fill();c.stroke();
  c.fillStyle='#e5f5fa';c.font='500 25px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(String(count),32,33);
  const image=canvas.toDataURL('image/png');if(clusterIcons.size>=64)clusterIcons.delete(clusterIcons.keys().next().value);clusterIcons.set(count,image);return image;
}
export function eventIcon(category,frame=0){
  const key=`${category}:${frame}`;if(icons.has(key))return icons.get(key);
  const spec=EVENT_CATEGORIES[category]||EVENT_CATEGORIES.other;
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d');
  c.translate(32,32);c.fillStyle='rgba(5,14,24,.9)';c.strokeStyle=spec.color;c.lineWidth=2;
  c.beginPath();c.arc(0,0,24,0,Math.PI*2);c.fill();c.stroke();c.lineWidth=2.2;c.lineCap='round';c.lineJoin='round';
  if(spec.symbol==='spiral'){
    c.rotate(frame*Math.PI/6);
    for(let arm=0;arm<2;arm++){c.beginPath();for(let i=0;i<=32;i++){const a=i/32*Math.PI*1.5+arm*Math.PI,r=3+i/32*14;const x=Math.cos(a)*r,y=Math.sin(a)*r;if(!i)c.moveTo(x,y);else c.lineTo(x,y);}c.stroke();}
  }else if(spec.symbol==='water'){
    for(let y=-9;y<=9;y+=9){c.beginPath();c.moveTo(-15,y);c.bezierCurveTo(-8,y-8,-4,y+8,3,y);c.bezierCurveTo(9,y-7,12,y+5,16,y);c.stroke();}
  }else if(spec.symbol==='fire'){
    c.beginPath();c.moveTo(0,-17);c.bezierCurveTo(2,-1,17,-2,12,12);c.bezierCurveTo(1,27,-21,8,-10,-3);c.lineTo(-7,5);c.quadraticCurveTo(2,-4,0,-17);c.stroke();
  }else if(spec.symbol==='mountain'){
    c.beginPath();c.moveTo(-17,14);c.lineTo(-2,-15);c.lineTo(17,14);c.closePath();c.moveTo(-8,-3);c.lineTo(-2,0);c.lineTo(4,-3);c.stroke();
  }else if(spec.symbol==='snow'){
    for(let i=0;i<6;i++){c.rotate(Math.PI/3);c.beginPath();c.moveTo(0,0);c.lineTo(0,-17);c.moveTo(-5,-10);c.lineTo(0,-5);c.lineTo(5,-10);c.stroke();}
  }else if(spec.symbol==='dry'){
    c.beginPath();c.moveTo(-16,-8);c.lineTo(-4,-1);c.lineTo(-8,15);c.moveTo(-4,-1);c.lineTo(10,-12);c.moveTo(-4,-1);c.lineTo(15,12);c.stroke();
  }else{
    for(const r of [5,11,17]){c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.stroke();}
  }
  const image=canvas.toDataURL('image/png');icons.set(key,image);return image;
}

export function createNaturalEventLayer(viewer,{onSelect=()=>{},reduced=prefersReducedMotion,makeIcon=eventIcon,makeClusterIcon=clusterIcon,now=()=>performance.now()}={}){
  const source=new CustomDataSource('OrbitWatch reported natural events'),focus=new CustomDataSource('OrbitWatch selected natural event');
  let destroyed=false,enabled=false,records=[],selected=null,signature='',removeFrame=null,selectedEntity=null,savedCamera=null,focusGeneration=0,focusFlight=false;
  source.clustering.enabled=true;source.clustering.pixelRange=44;source.clustering.minimumClusterSize=3;
  const removeCluster=source.clustering.clusterEvent.addEventListener((entities,cluster)=>{
    // Bake number + disc into ONE depth-tested sprite. Separate coincident
    // point/label primitives depth-fight and clip cluster digits in real WebGL.
    cluster.billboard.show=true;cluster.billboard.image=makeClusterIcon(entities.length);
    cluster.billboard.width=30;cluster.billboard.height=30;cluster.billboard.disableDepthTestDistance=0;
    cluster.label.show=false;cluster.point.show=false;
    // A cluster consumes the click; its members remain individually accessible
    // in the accessible recent-report list. Never select an arbitrary incident.
    cluster.billboard.id={orbitwatchEventCluster:true};
  });
  for(const ds of [source,focus])viewer.dataSources.add(ds).then(()=>{if(destroyed&&!viewer.isDestroyed())viewer.dataSources.remove(ds,true);});
  function entity(event,isSelected=false){
    const spec=EVENT_CATEGORIES[event.category]||EVENT_CATEGORIES.other;
    return {id:`natural:${isSelected?'selected:':''}${event.id}`,name:event.title,
      properties:{naturalEventId:event.id},position:Cartesian3.fromDegrees(event.position[0],event.position[1],1000),
      billboard:{image:makeIcon(event.category),scale:1,rotation:0,width:isSelected?40:29,height:isSelected?40:29,
        verticalOrigin:VerticalOrigin.CENTER,disableDepthTestDistance:0,scaleByDistance:new NearFarScalar(1e6,1,5e7,.75)},
      label:isSelected?{text:event.title.length>52?`${event.title.slice(0,49)}…`:event.title,font:'13px sans-serif',
        fillColor:Color.fromCssColorString(spec.color),showBackground:true,backgroundColor:Color.fromCssColorString('#07101ee6'),
        pixelOffset:new Cartesian2(0,-34),disableDepthTestDistance:0}:undefined};
  }
  function boundaries(event){
    return [...(event.geometry?.type==='Polygon'||event.geometry?.type==='MultiPolygon'?[event.geometry]:[]),...(event.boundaries||[])].slice(0,16);
  }
  function addBoundaries(target,event,prefix){
    let count=0;
    for(const geometry of boundaries(event)){
      const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
      if(!Array.isArray(polygons))continue;
      for(const polygon of polygons)for(const ring of polygon){
        if(!Array.isArray(ring)||ring.length<4||ring.length>2048||count+ring.length>4096||ring.some(p=>!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90))continue;
        count+=ring.length;target.entities.add({id:`${prefix}:${event.id}:${count}`,properties:{naturalEventId:event.id},polyline:{positions:Cartesian3.fromDegreesArray(ring.flat()),width:1.5,arcType:ArcType.GEODESIC,
          material:Color.fromCssColorString(EVENT_CATEGORIES[event.category]?.color||'#b4ccd8').withAlpha(.65)}});
      }
    }
  }
  function addTrack(event){
    for(const kind of ['observed','forecast']){
      const points=trackPoints(event.track,kind);
      for(const [i,segment] of trackSegments(points).entries())focus.entities.add({id:`track:${kind}:${i}:${event.id}`,properties:{naturalEventId:event.id,trackKind:kind},polyline:{positions:segment.map(p=>Cartesian3.fromDegrees(p.longitude,p.latitude,5000)),arcType:ArcType.GEODESIC,width:kind==='observed'?3:2.5,
        material:kind==='observed'?new PolylineGlowMaterialProperty({glowPower:.15,color:Color.fromCssColorString('#89e4dd')}):new PolylineDashMaterialProperty({color:Color.fromCssColorString('#f4cf9a'),dashLength:18})}});
      const subset=datedPointSubset(points,kind==='observed'?48:16);
      for(const [i,p] of subset.entries())focus.entities.add({id:`trackpoint:${kind}:${i}:${event.id}`,name:`${kind==='observed'?'Reported':'Forecast'} ${p.at}`,properties:{naturalEventId:event.id,trackKind:kind,sourceTimestamp:p.at},position:Cartesian3.fromDegrees(p.longitude,p.latitude,6000),
        point:{pixelSize:kind==='forecast'?8:i===subset.length-1?7:4,color:Color.fromCssColorString(kind==='forecast'?'#f4cf9a':windColor(p)).withAlpha(kind==='forecast'?.12:1),outlineColor:Color.fromCssColorString(kind==='forecast'?'#f4cf9a':'#07101e'),outlineWidth:kind==='forecast'?2:1,disableDepthTestDistance:0},
        label:i===subset.length-1||kind==='forecast'&&i%3===0?{text:`${kind==='forecast'?'FCST · ':''}${new Date(p.at).toISOString().slice(5,16).replace('T',' ')} UTC${Number.isFinite(p.wind)?`\n${p.wind} ${p.wind_units} · ${p.wind_averaging_minutes||'?'} min`:''}`,font:'11px sans-serif',fillColor:Color.fromCssColorString('#dceff0'),showBackground:true,backgroundColor:Color.fromCssColorString('#07101ed9'),pixelOffset:new Cartesian2(10,kind==='observed'?28:-14),disableDepthTestDistance:0}:undefined});
    }
  }
  function select(id){
    removeFrame?.();removeFrame=null;focus.entities.removeAll();selected=id;selectedEntity=null;
    for(const e of source.entities.values)e.show=e.properties.naturalEventId.getValue()!==id;
    const event=records.find(e=>e.id===id);if(!enabled||!event)return;
    if(Array.isArray(event.position))selectedEntity=focus.entities.add(entity(event,true));
    addBoundaries(focus,event,'selected-boundary');
    if(event.category==='cyclone'&&event.track)addTrack(event);
    if(selectedEntity&&!reduced()&&['cyclone','earthquake'].includes(event.category)){
      removeFrame=viewer.scene.preRender.addEventListener(()=>{
        if(destroyed||!enabled||!selectedEntity)return;
        if(reduced()){selectedEntity.billboard.scale.setValue(1);selectedEntity.billboard.rotation.setValue(0);return;}
        if(event.category==='cyclone'){
          // Native rotation of one sprite, no stepped texture swaps or fake
          // movement of the source location. Purely illustrative, 24s/cycle.
          selectedEntity.billboard.rotation.setValue((now()%24000)/24000*Math.PI*2);
        }else selectedEntity.billboard.scale.setValue(1+.06*Math.sin(now()/900));
        viewer.scene.requestRender();
      });
    }
  }
  return {
    update({events=[],visible=false,category='all',selectedId=null}){
      if(destroyed||viewer.isDestroyed())return;
      const visibilityChanged=enabled!==visible;enabled=visible;source.show=visible;focus.show=visible;
      const next=events.filter(e=>category==='all'||e.category===category).slice(0,1200);
      // Source revisions can change a title/category/extent without changing
      // the report time or point. Include all visual inputs, not retrieval time.
      const key=JSON.stringify(next.map(e=>[e.id,e.reported_at,e.category,e.title,e.position,e.geometry,e.track,e.boundaries,e.track?.forecast?.length?Date.parse(e.track.expires_at)>Date.now():false]));
      records=next;
      if(key!==signature||visibilityChanged){
        signature=key;records=next;source.entities.suspendEvents();source.entities.removeAll();
        if(visible){let polygonCount=0;for(const event of next){if(Array.isArray(event.position))source.entities.add(entity(event));else if(polygonCount++<80)addBoundaries(source,event,'context-boundary');}}source.entities.resumeEvents();select(selectedId);
      }else if(selected!==selectedId||(!visible&&removeFrame)||(visible&&selectedId&&!selectedEntity))select(selectedId);
      viewer.scene.requestRender();
      if(!visible){if(focusFlight)viewer.camera?.cancelFlight?.();focusFlight=false;savedCamera=null;focusGeneration++;}
    },
    focusEvent(id){
      const event=records.find(e=>e.id===id),camera=viewer.camera;
      if(!enabled||!event||!camera)return false;
      const points=event.track?[...trackPoints(event.track),...trackPoints(event.track,'forecast')].map(p=>Cartesian3.fromDegrees(p.longitude,p.latitude)):[];
      if(!points.length&&Array.isArray(event.position))points.push(Cartesian3.fromDegrees(...event.position));
      if(!points.length)for(const g of boundaries(event)){const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;for(const polygon of polygons)for(const ring of polygon)for(const p of ring)points.push(Cartesian3.fromDegrees(...p));}
      if(!points.length)return false;
      savedCamera||={position:Cartesian3.clone(camera.positionWC),direction:Cartesian3.clone(camera.directionWC),up:Cartesian3.clone(camera.upWC)};
      const sphere=BoundingSphere.fromPoints(points);sphere.radius=Math.max(250000,sphere.radius);
      const range=Math.max(800000,sphere.radius*4.2),generation=++focusGeneration;focusFlight=true;
      camera.flyToBoundingSphere(sphere,{duration:reduced()?0:1.4,offset:new HeadingPitchRange(0,-Math.PI/2,range),complete:()=>{
        focusFlight=false;
        if(destroyed||generation!==focusGeneration||!savedCamera)return;
        const canvas=viewer.scene.canvas;
        // Keep the framed route left of the desktop report panel. Narrow
        // screens close that panel and retain a dedicated return toolbar.
        if(canvas?.clientWidth>=1100)camera.moveRight?.(2*range*Math.tan((camera.frustum?.fovy||Math.PI/3)/2)/canvas.clientHeight*160);
        viewer.scene.requestRender();
      },cancel:()=>{focusFlight=false;}});return true;
    },
    returnFromFocus(){
      if(!savedCamera||!viewer.camera)return false;
      const saved=savedCamera;savedCamera=null;focusGeneration++;focusFlight=false;viewer.camera.cancelFlight?.();viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      viewer.camera.setView({destination:saved.position,orientation:{direction:saved.direction,up:saved.up}});viewer.scene.requestRender();return true;
    },
    pick(picked){
      const id=picked?.id;
      if(id?.orbitwatchEventCluster)return true;
      const eventId=id?.properties?.naturalEventId?.getValue?.();if(!eventId)return false;
      onSelect(eventId);return true;
    },
    diagnostics(){return {visible:enabled,context:source.entities.values.length,selected:focus.entities.values.length,animated:!!removeFrame,
      selectedId:selected,clustered:source.clustering.enabled};},
    destroy(){
      if(destroyed)return;destroyed=true;removeFrame?.();removeFrame=null;removeCluster();
      for(const ds of [source,focus])if(!viewer.isDestroyed())viewer.dataSources.remove(ds,true);
      if(focusFlight)viewer.camera?.cancelFlight?.();records=[];selectedEntity=null;savedCamera=null;focusFlight=false;
    },
  };
}
