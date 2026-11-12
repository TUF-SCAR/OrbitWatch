import {paletteColor} from './weatherPalettes.js';
import {rainColor} from './precipitationStyle.js';

export const PHASE_PALETTES={
  snow:[[.1,34,201,221],[1,65,226,241],[5,127,242,253],[12,174,247,255],[25,213,253,255],[50,161,214,255]],
  freezing_rain:[[.1,178,133,235],[1,191,152,250],[5,212,186,255],[12,227,209,255],[25,240,227,255],[50,248,239,255]],
  ice_pellets:[[.1,63,198,155],[1,95,225,180],[5,147,244,205],[12,182,250,224],[25,213,255,238],[50,232,255,248]],
  mixed:[[.1,205,118,190],[1,223,145,211],[5,237,181,229],[12,246,207,240],[25,252,227,250],[50,255,240,254]],
};
export const PHASE_LABELS={rain:'Rain',snow:'Snow',freezing_rain:'Freezing rain',ice_pellets:'Ice pellets',mixed:'Mixed',unknown:'Unknown phase'};
export function phaseNodes(field){
  const p=field?.precipitation_phase;
  return field?.source_kind!=='era5'&&p?.units==='category'&&p.level==='surface'&&p.step_type==='instant'&&p.valid_at===field.valid_at&&p.values?.length===65160?p.values:null;
}
export function phaseAtNodes(values,longitude,latitude){
  if(!values||!Number.isFinite(longitude)||!Number.isFinite(latitude))return 'unknown';
  const x=((Math.round(longitude+180)%360)+360)%360,y=Math.max(0,Math.min(180,Math.round(90-latitude)));
  const phase=values[y*360+x];return Object.hasOwn(PHASE_LABELS,phase)?phase:'unknown';
}
export function phaseColor(value,phase){
  const rain=rainColor(value),palette=PHASE_PALETTES[phase];
  return palette&&rain[3]?paletteColor(palette,value,rain[3],true):rain;
}
