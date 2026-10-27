// Liquid-equivalent model rate, not rain/snow classification or observed radar.
export const RAIN_STOPS = [[.1,126,199,244],[1,87,151,236],[5,111,91,204],[12,196,74,159],[25,241,106,91],[50,255,223,104]];
export const RAIN_GRADIENT = `linear-gradient(90deg,${RAIN_STOPS.map(([,r,g,b])=>`rgb(${r},${g},${b})`).join(',')})`;
export const RAIN_PROFILES = Object.freeze({
  performance:{width:720,particles:160,fps:20},
  balanced:{width:1080,particles:320,fps:24},
  quality:{width:1440,particles:560,fps:30},
});
export const rainBudget=quality=>RAIN_PROFILES[quality]||RAIN_PROFILES.balanced;
export function rainColor(value) {
  if(!Number.isFinite(value)||value<=.05)return [0,0,0,0];
  let lo=RAIN_STOPS[0],hi=lo;
  for(const stop of RAIN_STOPS){hi=stop;if(value<=stop[0])break;lo=stop;}
  const t=hi===lo?0:Math.max(0,Math.min(1,Math.log(value/lo[0])/Math.log(hi[0]/lo[0])));
  const a=Math.min(1,Math.max(0,(value-.05)/.15));
  return [...lo.slice(1).map((v,i)=>Math.round(v+(hi[i+1]-v)*t)),Math.round((165+65*Math.min(1,Math.log1p(value)/Math.log(51)))*a)];
}

