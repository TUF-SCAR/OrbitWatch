import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';

test('card and Weather panel share real units/UTC content while coordinate editing is removed',async()=>{
  const server=await createServer({configFile:false,plugins:[react()],server:{middlewareMode:true},appType:'custom'});
  try {
    const {default:Card}=await server.ssrLoadModule('/src/components/LocationWeatherCard.jsx');
    const {default:Panel}=await server.ssrLoadModule('/src/components/WeatherPanel.jsx');
    const location={selection:{name:'Known city',latitude:10,longitude:20},state:'ready',freshness:'available',clock:Date.parse('2026-11-01T12:00Z'),data:{valid_at:'2026-11-01T12:00Z',retrieved_at:'2026-11-01T12:05Z',interval_seconds:900,grid_latitude:10,grid_longitude:20,values:{temperature_2m:0,wind_speed_10m:36,pressure_msl:null,weather_code:0},units:{temperature_2m:'°C',wind_speed_10m:'km/h'}}};
    const card=renderToStaticMarkup(createElement(Card,{weather:location}));
    assert.match(card,/Known city/);assert.match(card,/0 °C/);assert.match(card,/36 km\/h/);assert.match(card,/Unavailable/);assert.match(card,/12:00 UTC/);assert.match(card,/Close location weather/);
    const panel=renderToStaticMarkup(createElement(Panel,{open:true,tab:'layers',variable:'temperature',opacity:.55,enabled:true,compatible:true,locationWeather:location,weather:{state:'available',clock:location.clock,field:{valid_at:location.data.valid_at,kind:'forecast'}}}));
    assert.match(panel,/Click anywhere on Earth/);assert.match(panel,/WEATHER AT VIEW CENTRE/);assert.match(panel,/Known city/);assert.match(panel,/36 km\/h/);
    assert.doesNotMatch(panel,/Weather latitude|Weather longitude|GET WEATHER|weather-coordinates/);
    const stateCard=renderToStaticMarkup(createElement(Card,{weather:{...location,selection:{...location.selection,kind:'state',name:'Ontario',country:'Canada'}}}));
    assert.match(stateCard,/Ontario/);assert.match(stateCard,/State \/ province · Canada/);assert.match(stateCard,/representative label coordinate, not an average/);
  } finally {await server.close();}
});
