import { BillboardCollection, Cartesian2, Cartesian3, Cartographic, Color, Math as CesiumMath } from 'cesium';
import { sampleModel } from './weatherFields.js';
import { rainBudget } from './precipitationStyle.js';
import { prefersReducedMotion } from '../utils/motionPreferences.js';

function streakImage(){
  const c=document.createElement('canvas');c.width=4;c.height=24;
  const ctx=c.getContext('2d'),g=ctx.createLinearGradient(0,0,0,24);
  g.addColorStop(0,'rgba(229,246,255,0)');g.addColorStop(.65,'rgba(229,246,255,.8)');g.addColorStop(1,'rgba(229,246,255,0)');
  ctx.fillStyle=g;ctx.fillRect(1,0,2,24);return c;
}
// Screen-down streaks are symbolic precipitation activity, not trajectories or
// falling-water velocities. Every anchor is sampled from the real model field.
export function createRainLayer(viewer,{now=()=>performance.now(),doc=document,reduced=prefersReducedMotion,
  makeCollection=()=>new BillboardCollection({scene:viewer.scene}),makeImage=streakImage}={}) {
  let field=null,quality='auto',opacity=.55,enabled=false,collection=null,items=[],removeFrame=null,removeMove=null,last=0,seed=0,refresh=true,destroyed=false,altitudeAlpha=1;
  const screen=new Cartesian2(),world=new Cartesian3(),geo=new Cartographic(),color=new Color(.88,.96,1,0),offset=new Cartesian2();
  function release(){removeFrame?.();removeMove?.();removeFrame=removeMove=null;if(collection)viewer.scene.primitives.remove(collection);collection=null;items=[];}
  function reconcile(){
    release();if(destroyed||!enabled||doc.hidden||opacity<=0||viewer.isDestroyed())return;
    collection=viewer.scene.primitives.add(makeCollection());collection.show=altitudeAlpha>0;const image=makeImage(),budget=rainBudget(quality);
    const count=Math.round(budget.particles*(viewer.scene.canvas.clientWidth<600?.55:1));
    for(let i=0;i<count;i++)items.push({billboard:collection.add({image,show:false,width:2,height:12,disableDepthTestDistance:0}),phase:(i*.61803398875)%1});
    seed=0;refresh=true;last=0;
    removeMove=viewer.camera.moveEnd.addEventListener(()=>{refresh=true;seed=0;});
    removeFrame=viewer.scene.preRender.addEventListener(tick);viewer.scene.requestRender();
  }
  function tick(){
    if(altitudeAlpha===0)return;
    const time=now(),budget=rainBudget(quality);if(time-last<1000/budget.fps)return;last=time;
    const canvas=viewer.scene.canvas,height=viewer.camera.positionCartographic.height;
    // Quiet at whole-globe scale, richer at regional scales; no fictitious zoom detail.
    const zoom=Math.max(0,Math.min(1,(14000000-height)/10000000));
    if(refresh){
      const end=Math.min(items.length,seed+40),cols=Math.ceil(Math.sqrt(items.length*canvas.clientWidth/canvas.clientHeight)),rows=Math.ceil(items.length/cols);
      for(;seed<end;seed++){
        const p=items[seed],x=seed%cols,y=Math.floor(seed/cols);
        screen.x=(x+.2+.6*p.phase)/cols*canvas.clientWidth;screen.y=(y+.2+.6*((seed*.41421356)%1))/rows*canvas.clientHeight;
        const hit=viewer.camera.pickEllipsoid(screen,viewer.scene.globe.ellipsoid,world);
        p.rate=null;p.billboard.show=false;
        if(!hit)continue;
        viewer.scene.globe.ellipsoid.cartesianToCartographic(hit,geo);
        const rate=sampleModel(field.values,CesiumMath.toDegrees(geo.longitude),CesiumMath.toDegrees(geo.latitude));
        if(rate===null||rate<.15)continue;
        p.rate=rate;p.billboard.position=Cartesian3.fromRadians(geo.longitude,geo.latitude,1500);
      }
      if(seed>=items.length)refresh=false;
    }
    const calm=reduced();
    for(const p of items){
      if(p.rate===null||p.rate===undefined||zoom===0){p.billboard.show=false;continue;}
      const phase=(p.phase+(calm?0:time/1100))%1;
      color.alpha=opacity*altitudeAlpha*zoom*(calm?.35:Math.sin(Math.PI*phase)*.7);
      p.billboard.color=color;p.billboard.height=6+Math.min(10,Math.log1p(p.rate)*3);
      offset.x=0;offset.y=calm?0:(phase-.5)*12;p.billboard.pixelOffset=offset;p.billboard.show=true;
    }
    if(!calm||refresh)viewer.scene.requestRender();
  }
  const visibility=()=>reconcile();doc.addEventListener('visibilitychange',visibility);
  return {
    setAltitudeAlpha(value){
      if(value===altitudeAlpha)return;
      const previous=altitudeAlpha;altitudeAlpha=value;if(collection)collection.show=value>0;
      for(const p of items){if(p.billboard.color&&previous>0){const c=Color.clone(p.billboard.color);c.alpha*=value/previous;p.billboard.color=c;}}
    },
    update(options){
      const next=options.field?.display_variable==='precipitation'?options.field:null;
      const active=Boolean(next&&options.visible&&options.compatible!==false),q=options.quality||'auto',a=options.opacity??.55;
      const rebuild=next!==field||active!==enabled||q!==quality||(a>0)!==(opacity>0);
      field=next;enabled=active;quality=q;opacity=a;if(rebuild)reconcile();
    },
    diagnostics:()=>({active:Boolean(collection),capacity:items.length,raining:items.filter(p=>p.billboard.show).length,reseeding:refresh}),
    destroy(){if(destroyed)return;destroyed=true;release();doc.removeEventListener('visibilitychange',visibility);},
  };
}
