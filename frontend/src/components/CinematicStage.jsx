import { useContext, useLayoutEffect, useRef } from "react";
import { HudAssemblyContext } from '../utils/hudAssemblyContext.js';
import "./CinematicStage.css";
export default function CinematicStage({ active, side, loaderAnchor, zIndex = 20, children }) {
  const owner=useContext(HudAssemblyContext),stage=useRef(null),shell=useRef(null),content=useRef(null);
  const id=loaderAnchor || side;
  useLayoutEffect(()=>owner?.register(id,{stage:stage.current,shell:shell.current,content:content.current}),[owner,id]);
  return <div ref={stage} className={`cinematic-stage ${active?'is-active':''}`} data-hud-id={id} style={{zIndex}} aria-hidden={!active} inert={!active}>
    <div ref={shell} className="cinematic-stage__morph">
      <div className="cinematic-stage__loader" aria-hidden="true"><i /></div>
      <div ref={content} className="cinematic-stage__content">{children}</div>
    </div>
  </div>;
}
