// One clock and cancellation owner per App session. Targets initialize while
// hidden; the same morph frame remains around their mounted content.
export function footprint(nodes) {
  const rects=nodes.map(node=>node.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
  if(!rects.length)return null;
  const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top));
  return {left,top,width:Math.max(...rects.map(r=>r.right))-left,height:Math.max(...rects.map(r=>r.bottom))-top};
}
export function revealPlan(entries,timing) {
  return [...entries].sort((a,b)=>a.rect.width*a.rect.height-b.rect.width*b.rect.height||a.id.localeCompare(b.id))
    .map((entry,index)=>({...entry,delay:timing.loader+index*timing.interval}));
}
export function createHudAssembly({animate,timings,reduced,root:rootReader,raf=requestAnimationFrame,caf=cancelAnimationFrame,now=()=>performance.now()}) {
  let rootNode;
  const root=()=>rootReader?rootReader():rootNode;
  const entries=new Map(),completed=new Set();
  let frame,plan,start,running=false,generation=0;
  function layout(entry,ready) {
    // Measure the viewport-positioned children without the previous frame offset.
    Object.assign(entry.content.style,{left:'0px',top:'0px',width:`${entry.stage.clientWidth}px`,height:`${entry.stage.clientHeight}px`});
    const marks=[...entry.content.querySelectorAll('[data-hud-footprint]')];
    const measured=footprint(marks.length?marks:[...entry.content.children]);
    if(!measured)return null;
    const origin=entry.content.getBoundingClientRect();
    const rect={...measured,left:measured.left-origin.left,top:measured.top-origin.top};entry.rect=rect;
    Object.assign(entry.content.style,{left:`${-rect.left}px`,top:`${-rect.top}px`});
    if(ready)Object.assign(entry.shell.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,borderRadius:'var(--ui-radius)'});
    return rect;
  }
  function finish(entry) {
    entry.phase='ready';entry.stage.dataset.hudPhase='ready';entry.stage.inert=false;
    entry.stage.setAttribute?.('aria-hidden','false');
    completed.add(entry.id);entry.shell.style.overflow='visible';
  }
  function reveal(entry) {
    if(!entries.has(entry.id))return;
    entry.phase='morph';entry.stage.dataset.hudPhase='morph';entry.stage.dataset.hudRevealAt=String(now());
    const {rect}=entry,t=timings(),radius=getComputedStyle(entry.stage).getPropertyValue('--ui-radius').trim()||'3px';
    entry.animation=animate(entry.shell,{left:rect.left,top:rect.top,width:rect.width,height:rect.height,borderRadius:radius},{duration:t.morph/1000,ease:t.ease});
    const token=generation;
    entry.animation.then(()=>{if(token===generation&&entries.get(entry.id)===entry)finish(entry);});
  }
  function tick(time) {
    if(!running)return;
    if(!plan) {
      const measured=[...entries.values()].filter(e=>!completed.has(e.id)).map(e=>layout(e,false)?e:null).filter(Boolean);
      plan=revealPlan(measured,timings());start=time;
      for(const item of plan) {
        const entry=entries.get(item.id);Object.assign(entry.shell.style,{left:`${item.rect.left+item.rect.width/2-27}px`,top:`${item.rect.top+item.rect.height/2-27}px`,width:'54px',height:'54px',borderRadius:'50%',overflow:'hidden'});
        entry.stage.inert=true;entry.stage.setAttribute?.('aria-hidden','true');
        entry.phase='loading';entry.stage.dataset.hudPhase='loading';entry.stage.dataset.hudArea=String(item.rect.width*item.rect.height);entry.stage.dataset.hudStartedAt=String(time);
      }
    }
    for(const item of plan){const entry=entries.get(item.id);if(entry?.phase==='loading'&&time-start>=item.delay)reveal(entry);}
    if(plan.every(e=>entries.get(e.id)?.phase==='ready'||!entries.has(e.id))){running=false;root().dataset.hudState='ready';return;}
    frame=raf(tick);
  }
  return {
    setRoot(node){rootNode=node;},
    register(id,nodes) {
      const entry={id,...nodes,phase:'waiting'};entries.set(id,entry);entry.stage.dataset.hudPhase='waiting';entry.stage.inert=true;
      let lastWidth=entry.stage.clientWidth,lastHeight=entry.stage.clientHeight;
      const observer=new ResizeObserver(()=>{
        const changed=lastWidth!==entry.stage.clientWidth||lastHeight!==entry.stage.clientHeight;
        lastWidth=entry.stage.clientWidth;lastHeight=entry.stage.clientHeight;
        if(entry.phase==='ready')layout(entry,true);
        else if(changed&&entry.phase==='morph'){entry.animation?.stop();layout(entry,true);finish(entry);}
      });
      observer.observe(entry.stage);
      [...entry.content.children].forEach(child=>observer.observe(child));
      if(completed.has(id)||plan||root()?.dataset.hudState==='ready'){layout(entry,true);finish(entry);}
      return()=>{observer.disconnect();entry.animation?.stop();entries.delete(id);};
    },
    start() {
      generation++;caf(frame);plan=null;running=true;root().dataset.hudState='assembling';
      if(reduced()){for(const entry of entries.values()){layout(entry,true);finish(entry);}running=false;root().dataset.hudState='ready';}
      else frame=raf(tick);
    },
    cancel(){generation++;running=false;caf(frame);for(const entry of entries.values())entry.animation?.stop();},
    settle(){generation++;running=false;caf(frame);for(const entry of entries.values()){entry.animation?.stop();layout(entry,true);finish(entry);}if(root())root().dataset.hudState='ready';},
  };
}
