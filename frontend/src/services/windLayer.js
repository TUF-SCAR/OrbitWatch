import { Cartesian2, Cartographic, Ellipsoid, Math as CesiumMath } from 'cesium';
import { WIND_STYLE, windBudget } from './windConfig.js';
import { advectWind, windCartesian } from './windAdvection.js';
import { WindPrimitive } from './windPrimitive.js';

export function createWindLayer(viewer, {
  now = () => performance.now(), doc = document,
  media = window.matchMedia('(prefers-reduced-motion: reduce)'),
  schedule = (fn, ms) => setInterval(fn, ms), cancel = clearInterval,
  makePrimitive = capacity => new WindPrimitive(capacity),
  random = Math.random,
} = {}) {
  const scene = viewer.scene, canvas = scene.canvas;
  let field = null, visible = false, quality = 'auto', opacity = .55;
  let primitive = null, particles = [], timer = null, removeFrame = null, destroyed = false, lost = false;
  let last = 0, clock = 0, nextSample = 0, scale = 1, overload = 0, fps = 0, frames = 0, frameStart = 0, cost = 0;
  let generation = 0, refreshes = 0, pending = 0, refreshHeight = 0, observedHeight = 0, zoomChangedAt = 0, refreshedAt = 0;
  let healthySince=null,lastReduction=0,lastRecovery=0,previousCount=0;
  const step = [0,0], scratch = [0,0], point = new Cartesian2(), geo = new Cartographic();
  const historySize = WIND_STYLE.trailSegments + 1;
  function warmHistory(p, budget) {
    let lon=p.lon,lat=p.lat;
    const interval=WIND_STYLE.trailSeconds/WIND_STYLE.trailSegments;
    for(let j=1;j<historySize;j++) {
      if(!advectWind(field,lon,lat,-budget.speedMultiplier*interval,step,scratch))break;
      lon=step[0];lat=step[1];
      const at=historySize-j;
      windCartesian(lon,lat,p.history,at*3);p.times[at]=clock-j*interval;p.samples++;
    }
  }
  function seed(p, budget, warm = false) {
    p.generation=generation;
    let hit;
    for(let i=0;i<8&&!hit;i++) {
      point.x=random()*canvas.clientWidth; point.y=random()*canvas.clientHeight;
      hit=viewer.camera.pickEllipsoid(point,Ellipsoid.WGS84);
    }
    if(!hit){p.valid=false;return;}
    Ellipsoid.WGS84.cartesianToCartographic(hit,geo);
    p.lon=CesiumMath.toDegrees(geo.longitude);p.lat=CesiumMath.toDegrees(geo.latitude);
    p.valid=Math.abs(p.lat)<WIND_STYLE.maxLatitude;
    p.age=warm?WIND_STYLE.fadeSeconds+random()*(WIND_STYLE.lifetimeSeconds-2*WIND_STYLE.fadeSeconds):0;
    p.head=0;p.samples=0;
    windCartesian(p.lon,p.lat,p.position);
    p.history.set(p.position,0);p.times[0]=clock;
    if(p.valid)warmHistory(p,budget);
  }
  function release() {
    if(timer!==null)cancel(timer);timer=null;removeFrame?.();removeFrame=null;
    if(primitive)scene.primitives.remove(primitive);
    primitive=null;particles=[];last=0;fps=0;pending=0;
  }
  function tick() {
    if(!primitive||lost||doc.hidden||destroyed)return;
    const start=now(),interval=last?(start-last)/1000:0,dt=Math.min(WIND_STYLE.maxStepSeconds,interval);last=start;
    clock+=media.matches?0:dt;
    const budget=windBudget(quality,canvas.clientWidth,viewer.camera.positionCartographic.height);
    const count=Math.min(particles.length,Math.round(budget.particles*scale));
    // Inactive tails must return through the existing bounded warm-seed path,
    // rather than reappearing at an old camera position with stale history.
    for(let i=count;i<previousCount;i++){particles[i].valid=false;particles[i].generation=-1;}
    previousCount=count;
    const height=Math.max(WIND_STYLE.zoomHeightFloor,viewer.camera.positionCartographic.height);
    if(Math.abs(height-observedHeight)>observedHeight*.01){observedHeight=height;zoomChangedAt=start;}
    const ratio=Math.max(height/refreshHeight,refreshHeight/height);
    if(!pending&&ratio>=WIND_STYLE.zoomRefreshRatio&&start-zoomChangedAt>=WIND_STYLE.zoomSettleMs&&start-refreshedAt>=WIND_STYLE.zoomRefreshCooldownMs){
      generation++;refreshes++;refreshHeight=height;refreshedAt=start;
    }
    let seedsLeft=media.matches?count:WIND_STYLE.reseedPerUpdate;
    pending=0;
    const sample=clock>=nextSample;
    if(sample)nextSample=clock+WIND_STYLE.trailSeconds/WIND_STYLE.trailSegments;
    let offset=0;
    for(let i=0;i<count;i++) {
      const p=particles[i];
      let seeded=false;
      if(p.generation!==generation||!p.valid||p.age>WIND_STYLE.lifetimeSeconds){
        if(seedsLeft>0){seed(p,budget,p.generation!==generation);seedsLeft--;seeded=true;}
        else if(p.generation!==generation)pending++;
      }
      if(!p.valid)continue;
      if(!media.matches&&!seeded) {
        p.age+=dt;
        if(!advectWind(field,p.lon,p.lat,dt*budget.speedMultiplier,step,scratch)){p.valid=false;continue;}
        p.lon=step[0];p.lat=step[1];windCartesian(p.lon,p.lat,p.position);
      }
      let previous=p.position,previousOffset=0,previousAlpha=1;
      const life=media.matches?1:Math.min(1,p.age/WIND_STYLE.warmBirthSeconds,(WIND_STYLE.lifetimeSeconds-p.age)/WIND_STYLE.fadeSeconds);
      for(let j=0;j<=p.samples;j++) {
        const at=(p.head-j+historySize)%historySize;
        const alpha=Math.max(0,1-(clock-p.times[at])/WIND_STYLE.trailSeconds);
        if(alpha===0&&previousAlpha===0)break;
        const out=primitive.data;
        for(let k=0;k<3;k++){out[offset+k]=previous[previousOffset+k];out[offset+3+k]=p.history[at*3+k];}
        out[offset+6]=Math.max(0,life)*previousAlpha;out[offset+7]=Math.max(0,life)*alpha;offset+=8;
        previous=p.history;previousOffset=at*3;previousAlpha=alpha;
      }
      if(sample&&!media.matches&&!seeded){p.head=(p.head+1)%historySize;p.history.set(p.position,p.head*3);p.times[p.head]=clock;p.samples=Math.min(historySize-1,p.samples+1);}
    }
    primitive.count=offset/8;primitive.dirty=true;primitive.alpha=Math.min(1,opacity/.55);
    const elapsed=now()-start;cost=cost*.9+elapsed*.1;
    // Sustained CPU or whole-scene pressure sheds particles without adding work
    // to other renderers. Never simulate a hidden-tab catch-up jump.
    if(elapsed>WIND_STYLE.overloadMs||interval>2/budget.fps)overload++;else overload=Math.max(0,overload-1);
    if(overload>=WIND_STYLE.overloadFrames){
      scale=Math.max(WIND_STYLE.minimumScale,scale*.75);overload=0;healthySince=null;lastReduction=start;
    }else if(!media.matches&&elapsed<=WIND_STYLE.recoveryCpuMs&&interval<=WIND_STYLE.recoveryFrameFactor/budget.fps&&!pending){
      healthySince??=start;
      if(scale<1&&start-healthySince>=WIND_STYLE.recoveryHealthyMs&&start-lastReduction>=WIND_STYLE.recoveryCooldownMs&&start-lastRecovery>=WIND_STYLE.recoveryStepMs){
        scale=Math.min(1,scale+WIND_STYLE.recoveryStep);lastRecovery=start;
      }
    }else healthySince=null;
    frames++;if(start-frameStart>2000){fps=frames*1000/(start-frameStart);frameStart=start;frames=0;}
  }
  function reconcile() {
    release();
    scale=1;overload=0;healthySince=null;lastReduction=lastRecovery=now();previousCount=0;cost=0;
    if(destroyed||!visible||!field||opacity<=0||doc.hidden||lost||viewer.isDestroyed())return;
    const capacity=windBudget(quality,1000,0).particles;
    primitive=scene.primitives.add(makePrimitive(capacity*historySize));
    particles=Array.from({length:capacity},()=>({position:new Float64Array(3),history:new Float64Array(historySize*3),times:new Float64Array(historySize),valid:false}));
    clock=0;nextSample=0;frameStart=now();frames=0;
    generation++;pending=0;
    refreshHeight=observedHeight=Math.max(WIND_STYLE.zoomHeightFloor,viewer.camera.positionCartographic.height);
    zoomChangedAt=refreshedAt=now();
    tick();
    if(!media.matches){
      let period=1000/windBudget(quality,canvas.clientWidth,Infinity).fps;
      let deadline=now()+period;
      removeFrame=scene.preRender.addEventListener(()=>{
        const time=now();
        const nextPeriod=1000/windBudget(quality,canvas.clientWidth,Infinity).fps;
        if(nextPeriod!==period){
          period=nextPeriod;deadline=time+period;
          cancel(timer);timer=schedule(()=>scene.requestRender(),period);
        }
        if(time>=deadline){deadline=time+period-(time-deadline)%period;tick();}
      });
      timer=schedule(()=>scene.requestRender(),period);
    }
    scene.requestRender();
  }
  const onLost=()=>{lost=true;release();};
  const onRestored=()=>{lost=false;reconcile();};
  const removeMove=viewer.camera.moveEnd?.addEventListener(()=>{if(media.matches)reconcile();});
  doc.addEventListener('visibilitychange',reconcile);media.addEventListener('change',reconcile);
  canvas.addEventListener('webglcontextlost',onLost);canvas.addEventListener('webglcontextrestored',onRestored);
  return {
    update(options) {
      const next=options.field?.display_variable==='wind'?options.field:null;
      const nextVisible=Boolean(options.visible&&options.compatible&&next);
      const changed=next?.id!==field?.id||nextVisible!==visible||quality!==options.quality||(Number(options.opacity)>0)!==(opacity>0);
      field=next;visible=nextVisible;quality=options.quality;opacity=Number(options.opacity)||0;
      if(changed)reconcile();else if(primitive){primitive.alpha=Math.min(1,opacity/.55);scene.requestRender();}
    },
    diagnostics:()=>({active:!!primitive,animated:timer!==null,particles:particles.length,effectiveParticles:Math.round(windBudget(quality,canvas.clientWidth,viewer.camera.positionCartographic.height).particles*scale),segments:primitive?.count||0,gpuBytes:primitive?.data.byteLength||0,fps:+fps.toFixed(1),updateMs:+cost.toFixed(2),qualityScale:scale,zoomRefreshes:refreshes,reseedPending:pending,reduced:media.matches,contextLost:lost}),
    destroy(){if(destroyed)return;destroyed=true;release();removeMove?.();doc.removeEventListener('visibilitychange',reconcile);media.removeEventListener('change',reconcile);canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',onRestored);field=null;},
  };
}
