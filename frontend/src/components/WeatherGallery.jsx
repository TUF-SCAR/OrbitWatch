import { Check } from 'lucide-react';
import { WEATHER_OPTIONS } from '../data/weatherOptions.js';

export default function WeatherGallery({value,onChange}) {
  return <div className="weather-field-gallery map-gallery" role="group" aria-label="Weather field">
    {WEATHER_OPTIONS.map(option=><button key={option.id} type="button"
      className={`map-card weather-field-card ${value===option.id?'is-active':''}`}
      aria-pressed={value===option.id} onClick={()=>onChange(option.id)}>
      <span className="map-card__preview"><img src={option.preview} alt="" width="320" height="180"/></span>
      <span className="map-card__copy"><strong>{option.name}</strong><small>{option.description}</small></span>
      {value===option.id&&<span className="map-card__check" aria-hidden="true"><Check size={15}/></span>}
    </button>)}
  </div>;
}
