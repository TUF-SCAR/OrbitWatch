import { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { createHudAssembly } from '../services/hudAssembly.js';
import { hudTimings } from '../utils/uiConfig.js';
import { prefersReducedMotion } from '../utils/motionPreferences.js';
import { HudAssemblyContext } from '../utils/hudAssemblyContext.js';
export default function HudAssembly({active,cycle,children}) {
  const root=useRef(null);
  const [owner]=useState(()=>createHudAssembly({animate,timings:hudTimings,reduced:prefersReducedMotion}));
  useEffect(()=>{owner.setRoot(root.current);if(active)owner.start();return()=>owner.cancel();},[owner,active,cycle]);
  useEffect(()=>{
    const query=window.matchMedia('(prefers-reduced-motion: reduce)');
    const change=()=>{if(query.matches)owner.settle();};
    query.addEventListener('change',change);return()=>query.removeEventListener('change',change);
  },[owner]);
  return <HudAssemblyContext.Provider value={owner}><div ref={root} className="hud-assembly" data-hud-state="waiting">{children}</div></HudAssemblyContext.Provider>;
}
