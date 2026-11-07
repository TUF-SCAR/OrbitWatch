// Liquid-equivalent model rate, not rain/snow classification or observed radar.
import {PRECIPITATION_PALETTE,paletteColor,paletteGradient} from './weatherPalettes.js';
export const RAIN_STOPS=PRECIPITATION_PALETTE;
export const RAIN_GRADIENT=paletteGradient(RAIN_STOPS,true);
export const RAIN_PROFILES = Object.freeze({
  performance:{width:720,particles:160,fps:20},
  balanced:{width:1080,particles:320,fps:24},
  quality:{width:1440,particles:560,fps:30},
});
export const rainBudget=quality=>RAIN_PROFILES[quality]||RAIN_PROFILES.balanced;
export function rainColor(value) {
  if(!Number.isFinite(value)||value<=.05)return [0,0,0,0];
  const a=Math.min(1,Math.max(0,(value-.05)/.15));
  return paletteColor(RAIN_STOPS,value,Math.round((165+65*Math.min(1,Math.log1p(value)/Math.log(51)))*a),true);
}

