import { WEATHER_FIELDS } from '../services/weatherFields.js';

export const WEATHER_OPTIONS = [
  { id:'observedClouds', name:'Clouds', description:'Satellite infrared', preview:'/weather-previews/clouds.svg' },
  { id:'precipitation', name:'Precipitation', description:'GFS · mm/h', preview:'/weather-previews/precipitation.svg' },
  { id:'temperature', name:'Temperature', description:'GFS · 2 m air', preview:'/weather-previews/temperature.svg' },
  { id:'wind', name:'Wind', description:'GFS · 10 m flow', preview:'/weather-previews/wind.svg' },
].filter(option=>WEATHER_FIELDS[option.id]&&!WEATHER_FIELDS[option.id].hidden);
