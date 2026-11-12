import {WEATHER_FIELDS} from '../services/weatherFields.js';
import {PHASE_PALETTES,PHASE_LABELS,phaseNodes} from '../services/precipitationPhase.js';
import {paletteGradient} from '../services/weatherPalettes.js';
import {precipitationAppearance} from '../services/precipitationHoverVisual.js';

export default function WeatherScale({variable='temperature',units,field}){
  const spec=WEATHER_FIELDS[variable];if(!spec?.gradient)return null;
  const values=spec.ticks.map(tick=>Number(tick.replace('−','-').replace(/[≤≥+]/g,'')));
  const first=values[0],last=values.at(-1);
  const position=value=>100*(spec.logarithmic?Math.log(value/first)/Math.log(last/first):(value-first)/(last-first));
  return <div className={`weather-scale weather-scale--${variable}`} aria-label={`${spec.label} colour scale in ${units||spec.units}`}>
    <div className="weather-scale__heading"><strong>{spec.title}</strong><span>{units||spec.units}</span></div>
    <div className="weather-scale__ramp" style={{background:spec.gradient}}/>
    <div className="weather-scale__ticks">{spec.ticks.map((tick,index)=><span key={tick} style={{left:`${position(values[index])}%`}}>{tick}</span>)}</div>
    {variable==='precipitation'&&<div className="weather-scale__bands"><span>Light</span><span>Moderate</span><span>Heavy</span></div>}
    {variable==='precipitation'&&phaseNodes(field)&&<div className="weather-phase-key" aria-label="NOAA categorical precipitation colours">{['rain',...Object.keys(PHASE_PALETTES),'unknown'].map(phase=>{
      const appearance=precipitationAppearance({kind:phase,title:`Light ${PHASE_LABELS[phase]}`});
      return <span key={phase}><i aria-hidden="true" style={{backgroundImage:appearance.image}}/><b style={{background:phase==='rain'||phase==='unknown'?spec.gradient:paletteGradient(PHASE_PALETTES[phase],true)}}/>{PHASE_LABELS[phase]}</span>;
    })}</div>}
  </div>;
}
