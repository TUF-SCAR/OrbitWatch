import { createWorldImageryAsync, IonWorldImageryStyle, UrlTemplateImageryProvider } from "cesium";
import { localEarthReferenceProvider, nasaReferenceProvider } from "./nasaImagery.js";

export function createEarthMapFactories({ionToken,cartoKey,nasa,selectedTime}) {
  const ion=style=>ionToken ? createWorldImageryAsync({style}) : null;
  const carto=(path)=>cartoKey ? new UrlTemplateImageryProvider({
    url:`https://basemaps.cartocdn.com/${path}/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoKey)}`,
    credit:'© CARTO · © OpenStreetMap contributors',maximumLevel:20,
  }) : null;
  return {
    bing:()=>ion(IonWorldImageryStyle.AERIAL),
    'bing-labels':labels=>ion(labels ? IonWorldImageryStyle.AERIAL_WITH_LABELS : IonWorldImageryStyle.AERIAL),
    'bing-road':()=>ion(IonWorldImageryStyle.ROAD),
    esri:()=>new UrlTemplateImageryProvider({url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',credit:'Esri World Imagery · Esri / Maxar / Earthstar Geographics / GIS community',maximumLevel:19}),
    osm:()=>new UrlTemplateImageryProvider({url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',credit:'© OpenStreetMap contributors',maximumLevel:19}),
    'carto-dark':labels=>carto(labels ? 'dark_all' : 'dark_nolabels'),
    'carto-voyager':labels=>carto(`rastertiles/${labels ? 'voyager' : 'voyager_nolabels'}`),
    'nasa-reference':()=>({provider:nasaReferenceProvider(),details:{kind:'reference',observationDate:null,message:'NASA Blue Marble · fixed nonhistorical reference composite; not selected-date observations, live weather or current photography.'}}),
    'local-reference':()=>localEarthReferenceProvider(),
    'nasa-time':(_labels,{signal})=>nasa.create(selectedTime(),signal),
  };
}
