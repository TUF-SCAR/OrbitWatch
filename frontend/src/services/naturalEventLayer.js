import { Cartesian2, Cartesian3, Color, CustomDataSource, NearFarScalar, VerticalOrigin } from 'cesium';
import { prefersReducedMotion } from '../utils/motionPreferences.js';

export const EVENT_CATEGORIES={cyclone:{label:'Cyclones',color:'#b9b9ff',symbol:'spiral'},earthquake:{label:'Earthquakes',color:'#ffc486',symbol:'pulse'},
  flood:{label:'Floods',color:'#62d4ed',symbol:'water'},wildfire:{label:'Wildfires',color:'#f89979',symbol:'fire'},volcano:{label:'Volcanoes',color:'#d9a1a5',symbol:'mountain'},
  drought:{label:'Drought',color:'#d1bc80',symbol:'dry'},landslide:{label:'Landslides',color:'#b9ab95',symbol:'mountain'},
  storm:{label:'Storms',color:'#adbaff',symbol:'water'},snow_ice:{label:'Snow / ice',color:'#c9edff',symbol:'snow'},dust:{label:'Dust / haze',color:'#d7bc9a',symbol:'dry'},
  temperature_extreme:{label:'Temperature extremes',color:'#f4a58c',symbol:'pulse'},water_color:{label:'Water colour',color:'#85cfbd',symbol:'water'},other:{label:'Other reports',color:'#c6d0da',symbol:'pulse'}};

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
  let destroyed=false,enabled=false,records=[],selected=null,signature='',removeFrame=null,selectedEntity=null;
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
  function select(id){
    removeFrame?.();removeFrame=null;focus.entities.removeAll();selected=id;selectedEntity=null;
    for(const e of source.entities.values)e.show=e.properties.naturalEventId.getValue()!==id;
    const event=records.find(e=>e.id===id);if(!enabled||!event)return;
    selectedEntity=focus.entities.add(entity(event,true));
    if(event.geometry?.type==='Polygon'||event.geometry?.type==='MultiPolygon'){
      const polygons=event.geometry.type==='Polygon'?[event.geometry.coordinates]:event.geometry.coordinates;
      for(const polygon of polygons)for(const ring of polygon){
        focus.entities.add({properties:{naturalEventId:event.id},polyline:{positions:Cartesian3.fromDegreesArray(ring.flat()),width:1.5,clampToGround:true,
          material:Color.fromCssColorString(EVENT_CATEGORIES[event.category]?.color||'#b4ccd8').withAlpha(.7)}});
      }
    }
    if(!reduced()&&['cyclone','earthquake'].includes(event.category)){
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
      const next=events.filter(e=>category==='all'||e.category===category);
      // Source revisions can change a title/category/extent without changing
      // the report time or point. Include all visual inputs, not retrieval time.
      const key=JSON.stringify(next.map(e=>[e.id,e.reported_at,e.category,e.title,e.position,e.geometry]));
      records=next;
      if(key!==signature||visibilityChanged){
        signature=key;records=next;source.entities.suspendEvents();source.entities.removeAll();
        if(visible)for(const event of next)source.entities.add(entity(event));source.entities.resumeEvents();select(selectedId);
      }else if(selected!==selectedId||(!visible&&removeFrame)||(visible&&selectedId&&!selectedEntity))select(selectedId);
      viewer.scene.requestRender();
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
      records=[];selectedEntity=null;
    },
  };
}
