import catalog from '../../../backend/data/time_satellites.json' with {type:'json'};
import { SPACE_OBJECTS } from './spaceObjects.js';

export const TIME_SATELLITE_IDS = Object.freeze(catalog.norad_ids);
export const TIME_DEFAULT_OBJECTS = Object.freeze(catalog.default_ids);
export const TIME_OBJECTS = Object.freeze(TIME_SATELLITE_IDS.map(id=>SPACE_OBJECTS.find(object=>object.noradId===id)));
export function timeSatelliteAllowed(id) { return TIME_SATELLITE_IDS.includes(id); }
export function timeSatelliteSelection(ids) { return [...new Set(ids.filter(timeSatelliteAllowed))]; }
