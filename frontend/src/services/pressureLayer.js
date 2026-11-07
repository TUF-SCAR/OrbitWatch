import {Cartesian2,Cartesian3,Color,EllipsoidalOccluder,LabelCollection,LabelStyle,Material,PolylineCollection,SceneMode,SceneTransforms} from 'cesium';
import {pressureContours,pressureExtrema,pressureInterval,selectPressureLabels} from './pressureContours.js';
import {validateModelField} from './weatherFields.js';

export const PRESSURE_BUDGET={paths:2400,vertices:180000,candidates:1200,labels:48};
export function createPressureLayer(viewer,{compute,now=()=>performance.now(),
  extract=field=>compute?compute.pressure(field):{contours:pressureContours(field),extrema:pressureExtrema(field)},
  makeLines=()=>new PolylineCollection(),makeLabels=()=>new LabelCollection({scene:viewer.scene}),
  makeMaterial=()=>Material.fromType('PolylineOutline',{color:Color.WHITE.withAlpha(.88),outlineColor:Color.fromCssColorString('#385669').withAlpha(.22),outlineWidth:.45}),
  project=(position,result)=>SceneTransforms.worldToWindowCoordinates(viewer.scene,position,result),
  isVisible,
}={}){
  let lines=null,labels=null,removeFrame=null,key=null,entries=[],candidates=[],pool=[],opacity=.55,altitudeAlpha=1,last=-Infinity,band=0,builds=0,destroyed=false,generation=0,lineAlpha=NaN;
  const screen=new Cartesian2(),occluder=new EllipsoidalOccluder(viewer.scene.globe.ellipsoid);
  const visible=isVisible||(position=>viewer.scene.mode!==SceneMode.SCENE3D||occluder.isPointVisible(position));
  function release(){
    generation++;
    removeFrame?.();removeFrame=null;
    if(lines)viewer.scene.primitives.remove(lines);
    if(labels)viewer.scene.primitives.remove(labels);
    lines=labels=null;entries=[];candidates=[];pool=[];key=null;last=-Infinity;band=0;lineAlpha=NaN;
  }
  function alpha(){
    if(!lines)return;
    const a=altitudeAlpha*Math.min(1,opacity/.55);
    lines.show=labels.show=a>0;
    if(a!==lineAlpha){lineAlpha=a;for(const entry of entries)entry.line.material.uniforms.color=Color.WHITE.withAlpha(a*.88,entry.line.material.uniforms.color);}
    for(const label of pool){label.fillColor=Color.WHITE.withAlpha(a);label.outlineColor=Color.fromCssColorString('#294653').withAlpha(a*.55);}
  }
  function layout(){
    if(!lines||!lines.show||now()-last<150)return;last=now();
    const interval=pressureInterval(viewer.camera.positionCartographic.height);
    if(band!==interval){band=interval;for(const entry of entries)entry.line.show=entry.level%interval===0;}
    occluder.cameraPosition=viewer.camera.positionWC;
    const projected=[];
    for(const candidate of candidates){
      if(!candidate.type&&candidate.level%interval!==0||!visible(candidate.position))continue;
      const point=project(candidate.position,screen);
      if(point)projected.push({...candidate,x:point.x,y:point.y});
    }
    const accepted=selectPressureLabels(projected,viewer.scene.canvas.clientWidth,viewer.scene.canvas.clientHeight,PRESSURE_BUDGET.labels);
    for(let i=0;i<Math.max(pool.length,accepted.length);i++){
      const candidate=accepted[i];
      if(!pool[i])pool.push(labels.add({text:'',show:false,style:LabelStyle.FILL_AND_OUTLINE,outlineWidth:2,
        disableDepthTestDistance:0,id:{orbitwatchWeatherContour:true}}));
      const label=pool[i];label.show=Boolean(candidate);
      if(candidate){label.text=candidate.text;label.position=candidate.position;label.font=candidate.type?'600 18px system-ui, sans-serif':'600 12px system-ui, sans-serif';}
    }
    alpha();
  }
  return {
    update({field,visible:enabled,compatible=true,opacity:value=.55}){
      if(destroyed||viewer.isDestroyed())return;
      opacity=value;
      if(!enabled||!compatible||field?.display_variable!=='pressure'||value<=0){release();return;}
      if(key!==field.id){
        validateModelField('pressure',field);release();key=field.id;builds++;
        const token=generation;
        const populate=({contours,extrema})=>{
        if(token!==generation||destroyed||viewer.isDestroyed())return;
        lines=viewer.scene.primitives.add(makeLines());labels=viewer.scene.primitives.add(makeLabels());
        candidates=extrema.map(extreme=>({...extreme,position:Cartesian3.fromDegrees(extreme.longitude,extreme.latitude,10000),text:`${extreme.type}\n${Math.round(extreme.value)}`}));
        contours.sort((a,b)=>b.points.length-a.points.length);
        const totalPoints=contours.reduce((sum,contour)=>sum+contour.points.length,0);
        const extraAnchors=Math.max(0,PRESSURE_BUDGET.candidates-candidates.length-Math.min(contours.length,PRESSURE_BUDGET.candidates-candidates.length));
        let vertices=0;
        for(const contour of contours){
          if(entries.length>=PRESSURE_BUDGET.paths)break;
          if(vertices+contour.points.length>PRESSURE_BUDGET.vertices)continue;
          const positions=contour.points.map(([lon,lat])=>Cartesian3.fromDegrees(lon,lat,10000));vertices+=positions.length;
          // Cesium destroys a polyline's material on removal. Each line must
          // own its material, even when identical uniforms share GPU buckets.
          const line=lines.add({positions,width:2,material:makeMaterial(),id:{orbitwatchWeatherContour:true}});
          entries.push({line,level:contour.level});
          // Stable anchors along the actual contours, not per-frame extraction.
          const count=1+Math.floor(positions.length/totalPoints*extraAnchors);
          for(let i=0;i<count&&candidates.length<PRESSURE_BUDGET.candidates;i++){
            const index=Math.min(positions.length-1,Math.floor((i+.5)*positions.length/count));
            candidates.push({position:positions[index],level:contour.level,text:String(contour.level)});
          }
        }
        removeFrame=viewer.scene.preRender.addEventListener(layout);
        alpha();viewer.scene.requestRender();
        };
        const result=extract(field);
        if(result?.then)result.then(populate).catch(error=>{if(token===generation){key=null;if(error.name!=='AbortError')console.error('Pressure contours unavailable',error);}});
        else populate(result);
      }
      alpha();last=-Infinity;viewer.scene.requestRender();
    },
    setAltitudeAlpha(value){if(value!==altitudeAlpha){altitudeAlpha=value;alpha();}},
    diagnostics:()=>({paths:entries.length,candidates:candidates.length,labels:pool.filter(label=>label.show).length,builds,interval:band}),
    destroy(){if(destroyed)return;release();destroyed=true;},
  };
}
