import {motion} from 'motion/react';
import {useReducedMotionPreference} from '../utils/useReducedMotion.js';
export default function TimePreparation({time}) {
  const reduced=useReducedMotionPreference();
  return <motion.div className="time-preparation" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduced?.04:.16}}>
    <section aria-label="Preparing Time Explorer" aria-busy="true"><span className="eyebrow">ORBITWATCH · TIME EXPLORER</span><i className="time-preparation__indicator" aria-hidden="true" style={reduced?{animation:'none'}:undefined}/><h1>Traveling through time</h1><p role="status">{time.toISOString().replace('T',' ').slice(0,19)} UTC</p><small>Updating the shared astronomical scene. Your celestial destination stays selected.<br/>Imagery and optional archived satellites have independent availability.</small></section>
  </motion.div>;
}
