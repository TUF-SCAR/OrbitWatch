import {motion} from 'motion/react';
import {useEffect,useRef} from 'react';
import {useReducedMotionPreference} from '../utils/useReducedMotion.js';
import {formatDateTimeLocal} from '../utils/spaceFormatters.js';
export default function TimePreparation({time,onTimeChange}) {
  const reduced=useReducedMotionPreference(),input=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement,frame=requestAnimationFrame(()=>input.current?.focus());
    return ()=>{cancelAnimationFrame(frame);if(previous?.isConnected && !previous.closest('[inert]')) previous.focus();};
  },[]);
  return <motion.div className="time-preparation" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduced ? .04 : .16}}>
    <section aria-label="Preparing Time Explorer" aria-busy="true">
      <span className="eyebrow">ORBITWATCH · TIME EXPLORER</span>
      <i className="time-preparation__indicator" aria-hidden="true" style={reduced ? {animation:'none'} : undefined} />
      <h1>Preparing scene time</h1>
      <p role="status">{time.toLocaleString('en-GB',{timeZone:'UTC',hour12:false})} UTC</p>
      <label>Requested scene date and time (local)<input ref={input} type="datetime-local" value={formatDateTimeLocal(time)} onChange={event=>{const next=new Date(event.target.value);if(Number.isFinite(next.getTime())) onTimeChange(next);}} /></label>
      <small>Preparing celestial positions and a static Earth reference basemap.<br />Satellite availability depends on stored historical orbital elements. Historical weather remains unavailable.</small>
    </section>
  </motion.div>;
}
