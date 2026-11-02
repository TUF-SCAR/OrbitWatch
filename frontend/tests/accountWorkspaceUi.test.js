import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {createAccountSettings} from '../src/services/accountSettings.js';

test('tabbed account UI, real planet/event tiles, truthful inbox and escaped notification content',async()=>{
  const server=await createServer({configFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
  try {
    const {default:Profile}=await server.ssrLoadModule('/src/components/ProfilePanel.jsx');
    const {default:Skywatch}=await server.ssrLoadModule('/src/components/MySkywatch.jsx');
    const {default:Inbox}=await server.ssrLoadModule('/src/components/NotificationCentre.jsx');
    const {default:Hud}=await server.ssrLoadModule('/src/components/TopHud.jsx');
    const owner=createAccountSettings();const account={owner,state:{...owner.snapshot(),subscriptionPhase:'ready',inboxPhase:'ready',unreadCount:0}};
    const profile=renderToStaticMarkup(createElement(Profile,{open:true,user:{id:1,username:'fixture'},settings:{quality:'auto',preview3d:false},account}));
    for(const label of ['Account navigation','My Skywatch','Notifications','Preferences','Display settings'])assert.ok(profile.includes(label),label);
    const planets=renderToStaticMarkup(createElement(Skywatch,{account,tab:'celestial'}));for(const name of ['Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Moon'])assert.ok(planets.includes(`Follow ${name}`));assert.doesNotMatch(planets,/Follow Earth|Follow Sun/);assert.match(planets,/aria-pressed="false"/);
    const events=renderToStaticMarkup(createElement(Skywatch,{account,tab:'event'}));assert.match(events,/Follow Earthquakes/);assert.match(events,/current danger/);
    const empty=renderToStaticMarkup(createElement(Inbox,{account}));assert.match(empty,/No notifications yet/);assert.doesNotMatch(empty,/Mark read<|inbox-card is-/);
    const malicious={id:'fixture',kind:'event',target_id:'usgs:fixture',title:'<img src=x onerror=alert(1)>',message:'<script>bad</script>',created_at:'2026-11-01T12:00:00Z',source_at:'2026-11-01T11:00:00Z',read_at:null,is_expired:true};
    const inbox=renderToStaticMarkup(createElement(Inbox,{account:{owner,state:{...account.state,inbox:[malicious],unreadCount:1}}}));assert.match(inbox,/&lt;img/);assert.match(inbox,/&lt;script/);assert.doesNotMatch(inbox,/<script>|<img/);assert.match(inbox,/Expired/);assert.match(inbox,/Mark read/);
    const props={mode:'live',apiState:'online',currentUser:{username:'fixture'}};
    assert.doesNotMatch(renderToStaticMarkup(createElement(Hud,{...props,unreadCount:0})),/<b aria-hidden="true">/);
    assert.match(renderToStaticMarkup(createElement(Hud,{...props,unreadCount:2})),/Open notifications, 2 unread/);owner.destroy();
  }finally{await server.close();}
});
