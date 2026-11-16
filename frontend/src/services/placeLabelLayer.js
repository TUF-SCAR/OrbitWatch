import {Cartesian2,Cartesian3,Color,EllipsoidalOccluder,HorizontalOrigin,LabelCollection,LabelStyle,SceneMode,SceneTransforms,VerticalOrigin} from 'cesium';
import {PLACE_LABEL_RECORDS,labelAltitudeRange,selectLabelBoxes,nearestSelectablePlace,customPlaceLabelsForMap} from './placeLabelLayout.js';
import {createPlaceWeatherReadings} from './placeLabelWeather.js';

const FONTS={country:'600 14px Inter, system-ui, sans-serif',city:'500 13px Inter, system-ui, sans-serif',state:'500 12px Inter, system-ui, sans-serif',weather:'400 11px Inter, system-ui, sans-serif'};
const priority={country:0,city:1,state:2};

export function createPlaceLabelLayer(viewer,{
  makeCollection=()=>new LabelCollection({scene:viewer.scene}),
  measure=document.createElement('canvas').getContext('2d'),
  project=(entry,result)=>SceneTransforms.worldToWindowCoordinates(viewer.scene,entry.position,result),
  weather=createPlaceWeatherReadings(),places=PLACE_LABEL_RECORDS,
}={}) {
  const scene=viewer.scene,collection=scene.primitives.add(makeCollection());
  // Render text at CSS/device resolution, independently of the scene's reduced
  // GPU resolution. Selection, collision boxes and occlusion remain shared.
  const overlay=scene.canvas.parentElement&&typeof document!=='undefined'?document.createElement('div'):null;
  if(overlay){overlay.className='place-label-overlay';overlay.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2';scene.canvas.parentElement.appendChild(overlay);}
  const occluder=new EllipsoidalOccluder(scene.globe.ellipsoid),screen=new Cartesian2();
  const entries=places.map(place=>({...place,position:Cartesian3.fromDegrees(place.longitude,place.latitude,4500),range:labelAltitudeRange(place.kind,place.rank)}));
  const pool=[];let visible=new Map(),lastLayout=-Infinity;
  const colors={country:Color.fromCssColorString('#cde4e9'),city:Color.WHITE,state:Color.fromCssColorString('#b6c6ce'),weather:Color.fromCssColorString('#b6dfe5')};
  function textMetrics(text,font,size) {
    measure.font=font;const metrics=measure.measureText(text);
    return {width:Math.ceil(Math.max(metrics.width,(metrics.actualBoundingBoxLeft||0)+(metrics.actualBoundingBoxRight||0)))+4,
      height:Math.ceil(Math.max(size,(metrics.actualBoundingBoxAscent||0)+(metrics.actualBoundingBoxDescent||0)))+4};
  }
  function content(entry) {
    const lines=[entry.name,...weather.get(entry)],signature=lines.join('\n');
    if(entry.signature!==signature) {
      entry.signature=signature;entry.lines=lines;
      entry.metrics=lines.map((line,index)=>textMetrics(line,index?FONTS.weather:FONTS[entry.kind],index?11:entry.kind==='country'?14:entry.kind==='state'?12:13));
      entry.width=Math.max(...entry.metrics.map(item=>item.width));
      entry.height=entry.metrics.reduce((sum,item)=>sum+item.height,0)+(lines.length-1)*2;
    }
    return entry;
  }
  function slot() {
    const group={entry:null,signature:null,labels:[]};
    if(overlay){group.dom=document.createElement('div');group.dom.style.cssText='position:absolute;text-align:center;white-space:pre;transform:translate(-50%,-50%);font:500 13px/1.4 Inter,system-ui,sans-serif;color:white;text-shadow:0 1px 2px #000,1px 0 2px #000,-1px 0 2px #000,0 -1px 2px #000;background:#07121b55;border-radius:3px;padding:1px 3px';overlay.appendChild(group.dom);}
    for(let i=0;i<3;i++)group.labels.push(collection.add({text:'',position:Cartesian3.ZERO,show:false,horizontalOrigin:HorizontalOrigin.CENTER,verticalOrigin:VerticalOrigin.CENTER,
      fillColor:colors.weather,outlineColor:Color.BLACK.withAlpha(.95),outlineWidth:2,style:LabelStyle.FILL_AND_OUTLINE}));
    pool.push(group);return group;
  }
  function draw(entry,group) {
    const changed=group.entry?.id!==entry.id||group.signature!==entry.signature;
    if(changed) {
      let top=-entry.height/2;
      group.labels.forEach((label,index)=>{
        const text=entry.lines[index];label.show=Boolean(text);
        if(!text)return;
        label.text=text;label.position=entry.position;label.font=index?FONTS.weather:FONTS[entry.kind];label.fillColor=index?colors.weather:colors[entry.kind];
        label.pixelOffset=new Cartesian2(0,top+entry.metrics[index].height/2);top+=entry.metrics[index].height+2;
      });
      group.entry=entry;group.signature=entry.signature;
    }
    group.labels.forEach((label,index)=>{label.show=Boolean(entry.lines[index])&&!group.dom;});
    if(group.dom){group.dom.textContent=entry.lines.join('\n');group.dom.hidden=false;group.dom.style.left=entry.x+'px';group.dom.style.top=entry.y+'px';}
    return changed;
  }
  return {
    update(now,enabled,activeMap,context={}) {
      const updated=weather.configure(context),show=Boolean(enabled&&customPlaceLabelsForMap(activeMap));
      if(updated||collection.show!==show)lastLayout=-Infinity;
      collection.show=show;
      if(overlay){overlay.hidden=!show;occluder.cameraPosition=viewer.camera.positionWC;for(const group of visible.values()){
        const point=project(group.entry,screen);group.dom.hidden=!point||scene.mode===SceneMode.SCENE3D&&!occluder.isPointVisible(group.entry.position);
        if(point){group.dom.style.left=point.x+'px';group.dom.style.top=point.y+'px';}
      }}
      if(!show||now-lastLayout<200)return;
      lastLayout=now;
      const altitude=viewer.camera.positionCartographic.height,flat=scene.mode!==SceneMode.SCENE3D;
      occluder.cameraPosition=viewer.camera.positionWC;
      const candidates=[];
      for(const entry of entries) {
        const retained=visible.has(entry.id),margin=retained?1.03:1;
        if(altitude<entry.range[0]/margin||altitude>entry.range[1]*margin)continue;
        if(!flat&&!occluder.isPointVisible(entry.position))continue;
        const point=project(entry,screen);
        if(!point||point.x<0||point.y<0||point.x>scene.canvas.clientWidth||point.y>scene.canvas.clientHeight)continue;
        content(entry);candidates.push({...entry,x:point.x,y:point.y});
      }
      candidates.sort((a,b)=>priority[a.kind]-priority[b.kind]||a.rank-b.rank||Number(visible.has(b.id))-Number(visible.has(a.id))||a.id.localeCompare(b.id));
      const accepted=selectLabelBoxes(candidates,scene.canvas.clientWidth,scene.canvas.clientHeight,scene.canvas.clientWidth<600?28:45,new Set(visible.keys()));
      const wanted=new Set(accepted.map(entry=>entry.id)),next=new Map();let changed=false;
      for(const [id,group] of visible)if(!wanted.has(id)){group.labels.forEach(label=>{label.show=false;});if(group.dom)group.dom.hidden=true;changed=true;}
      const reserved=new Set(accepted.map(entry=>visible.get(entry.id)).filter(Boolean));
      const free=pool.filter(group=>!reserved.has(group));
      for(const entry of accepted) {
        const group=visible.get(entry.id)||free.shift()||slot();
        changed=draw(entry,group)||!visible.has(entry.id)||changed;
        group.entry=entry;next.set(entry.id,group);
      }
      visible=next;if(changed)viewer.scene.requestRender();
    },
    pickLocation(point) {
      if(!collection.show)return null;
      occluder.cameraPosition=viewer.camera.positionWC;
      const candidates=[],altitude=viewer.camera.positionCartographic.height;
      for(const group of visible.values()) {
        const entry=group.entry;
        if((group.dom?group.dom.hidden:!group.labels[0].show)||entry.kind==='country'||altitude<entry.range[0]/1.03||altitude>entry.range[1]*1.03)continue;
        if(scene.mode===SceneMode.SCENE3D&&!occluder.isPointVisible(entry.position))continue;
        const projected=project(entry,screen);
        if(projected&&projected.x+entry.width/2>0&&projected.x-entry.width/2<scene.canvas.clientWidth&&
          projected.y+entry.height/2>0&&projected.y-entry.height/2<scene.canvas.clientHeight)candidates.push({...entry,x:projected.x,y:projected.y});
      }
      return nearestSelectablePlace(candidates,point);
    },
    diagnostics:()=>({visible:collection.show?visible.size:0,glyphGroups:pool.length,labels:collection.length,weather:weather.diagnostics(),places:collection.show?[...visible.values()].map(({entry})=>({id:entry.id,name:entry.name,kind:entry.kind,lines:entry.lines,x:entry.x,y:entry.y})):[]}),
    destroy(){overlay?.remove();scene.primitives.remove(collection);visible.clear();},
  };
}
