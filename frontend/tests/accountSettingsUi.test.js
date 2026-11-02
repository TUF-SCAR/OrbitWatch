import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {createAccountSettings} from '../src/services/accountSettings.js';

test('profile foundation presents saved actions, four toggles, explicit timezone and honest loading/unavailable states',async()=>{
  const server=await createServer({configFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
  try {
    const {default:Settings}=await server.ssrLoadModule('/src/components/AccountNotificationSettings.jsx');
    const {default:Card}=await server.ssrLoadModule('/src/components/LocationWeatherCard.jsx');
    const owner=createAccountSettings();
    const prefs={notifications_enabled:false,satellite_alerts:false,celestial_alerts:false,natural_event_alerts:false,advance_warning_minutes:30,event_radius_km:100,quiet_hours_enabled:true,quiet_start:'22:00',quiet_end:'07:00',quiet_timezone_mode:'explicit',quiet_timezone:'UTC',version:0,max_event_radius_km:500};
    const render=state=>renderToStaticMarkup(createElement(Settings,{account:{owner,state}}));
    const html=render({...owner.snapshot(),phase:'ready',locations:[{id:'test',name:'Named spot',latitude:0,longitude:0,timezone:'UTC',version:1,is_default:false}],preferences:prefs,preferenceDraft:prefs});
    for(const text of ['Saved observation locations','Add location','Edit Named spot','Make Named spot default','Remove Named spot','Enable future notifications','Satellite visibility alerts','Planet / Moon viewing alerts','Natural-event alerts','Advance warning','Natural-event relevance radius','Quiet hours start','Explicit quiet-hours timezone','live delivery are not active yet','do not grant browser push permission'])assert.ok(html.includes(text),text);
    assert.match(render({...owner.snapshot(),phase:'loading'}),/Loading saved account settings/);
    assert.match(render({...owner.snapshot(),phase:'unavailable',error:'Settings unavailable'}),/Retry loading account settings/);
    owner.startNew({name:'Chosen point',latitude:0,longitude:0});assert.match(render({...owner.snapshot(),phase:'ready'}),/Location timezone/);
    const card=renderToStaticMarkup(createElement(Card,{weather:{selection:{latitude:0,longitude:0},state:'loading'},onSaveLocation(){}}));assert.match(card,/Save this location/);
    owner.destroy();
  }finally{await server.close();}
});
