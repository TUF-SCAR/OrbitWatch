import {WEATHER_FIELDS} from '../services/weatherFields.js';

export default function WeatherScale({variable='temperature',units}){
  const spec=WEATHER_FIELDS[variable];if(!spec?.gradient)return null;
  const values=spec.ticks.map(tick=>Number(tick.replace('−','-').replace(/[≤≥+]/g,'')));
  const first=values[0],last=values.at(-1);
  const position=value=>100*(spec.logarithmic?Math.log(value/first)/Math.log(last/first):(value-first)/(last-first));
  return <div className={`weather-scale weather-scale--${variable}`} aria-label={`${spec.label} colour scale in ${units||spec.units}`}>
    <div className="weather-scale__heading"><strong>{spec.title}</strong><span>{units||spec.units}</span></div>
    <div className="weather-scale__ramp" style={{background:spec.gradient}}/>
    <div className="weather-scale__ticks">{spec.ticks.map((tick,index)=><span key={tick} style={{left:`${position(values[index])}%`}}>{tick}</span>)}</div>
    {variable==='precipitation'&&<div className="weather-scale__bands"><span>Light</span><span>Moderate</span><span>Heavy</span></div>}
  </div>;
}
