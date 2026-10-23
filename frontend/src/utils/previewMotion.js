// Decorative compositions/speeds only. Live ephemerides never use this module.
export function previewSession(random=Math.random) {
  return { azimuth:random()*Math.PI*2, elevation:.42+random()*.3, distance:100+random()*14,
    phases:Array.from({length:8},()=>random()*Math.PI*2) };
}
export function previewStep(angle,index,seconds,speed) {
  return (angle + Math.max(0,Math.min(seconds,.1))*speed/(1+index*.34))%(Math.PI*2);
}
