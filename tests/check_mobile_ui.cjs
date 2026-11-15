/* Actual app on disposable account service; never uses production credentials. */
const {chromium,webkit}=require('../.setup-cache/browser-qa/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('.setup-cache/mobile-qa');fs.mkdirSync(out,{recursive:true});
const baseline=process.env.ORBITWATCH_MOBILE_BASELINE==='1';
let browser,page,currentCheck='';const errors=[],results=[];
async function shot(name){await page.screenshot({path:path.join(out,`${baseline?'before':'after'}-${name}.png`),animations:'disabled'});}
async function swipeList(locator,context,label){
 const r=await locator.boundingBox();if(label==='chrome'){
  const cdp=await context.newCDPSession(page),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height-25),end=Math.round(r.y+25);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++){await page.waitForTimeout(18);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+(end-y)*i/8}]});}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 }else{
  // Playwright's Windows mobile WebKit has no native wheel/swipe API.
  // Verify the real scroll container and reachability; do not claim device gestures.
  await locator.evaluate(n=>n.scrollBy(0,600));
 }
 await page.waitForTimeout(300);
}
async function close(){for(let i=0;i<8;i++){const b=page.locator('button[aria-label^="Close"]:visible').last();if(!await b.count())return;await b.click();await page.waitForTimeout(100);}}
async function check(name,work){if(process.env.ORBITWATCH_CHECK_FILTER&&!name.includes(process.env.ORBITWATCH_CHECK_FILTER))return;currentCheck=name;try{const result=await work();results.push({name,pass:result?.skip?null:true,...result});}catch(e){results.push({name,pass:false,error:e.message});await shot(name+'-failed').catch(()=>{});}await close().catch(()=>{});console.log(name,results.at(-1));fs.writeFileSync(path.join(out,`${baseline?'before':'after'}-checks${process.env.ORBITWATCH_CHECK_FILTER?'-filtered':''}.json`),JSON.stringify({results,errors},null,2));}
async function session(engine,viewport,touch=false){
 const context=await engine.newContext({viewport,hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});
 const login=await context.request.post('http://127.0.0.1:8001/api/auth/login',{data:{username_or_email:'delivery_fixture1',password:'Disposable-delivery-2026'}});
 assert.equal(login.status(),200);const auth=await login.json();
 await context.addInitScript(token=>{localStorage.setItem('orbitwatch_access_token',token);localStorage.setItem('orbitwatch_time_map','osm');},auth.access_token);
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(currentCheck+': '+e.message));
 await page.goto('http://127.0.0.1:5174',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('button',{name:'Open profile and settings'}).waitFor({timeout:60000});
 await page.locator('.boot-sequence').waitFor({state:'hidden',timeout:60000});
 await page.waitForTimeout(6000);return context;
}
(async()=>{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [w,h] of process.env.ORBITWATCH_MOBILE_ONLY==='1'?[]:[[1600,900],[1280,506],[769,506]]){
  const context=await session(browser,{width:w,height:h});
  assert.equal(await page.locator('.phone-tools,.phone-readouts').count(),0,'short/narrow desktop must keep desktop controls');
  await shot(`${w}x${h}-globe`);
  for(const key of ['c','s','/']){await page.keyboard.press(key);await shot(`${w}x${h}-${key==='/'?'catalog':key}`);await close();}
  await context.close();
 }
 if(baseline){
  const context=await session(browser,{width:390,height:844},true);await shot('390-globe');
  for(const key of ['c','s','/']){await page.keyboard.press(key);await shot(`390-${key==='/'?'catalog':key}`);if(key==='s'){await page.getByRole('button',{name:'CATALOG',exact:true}).click();await shot('390-planets');}await close();}
  await context.close();
 }else if(process.env.ORBITWATCH_DESKTOP_ONLY!=='1')await mobileJourneys(browser);
 await browser.close();
 if(!baseline&&process.env.ORBITWATCH_WEBKIT==='1'){
  browser=await webkit.launch({headless:true});await mobileJourneys(browser,'webkit');await browser.close();
 }
 assert.equal(errors.length,0,errors.join('\n'));assert.ok(results.every(r=>r.pass!==false),'See after-checks.json');
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
async function mobileJourneys(engine,label='chrome') {
 const context=await session(engine,{width:390,height:844},true);
 async function tools(name){const b=page.getByRole('button',{name:'Tools',exact:true});if(await b.getAttribute('aria-expanded')!=='true')await b.click();await page.locator('.phone-tools').getByRole('button',{name,exact:true}).click();}
 await check(label+'-globe-and-camera',async()=>{
  await shot(label+'-390-globe');assert.equal(await page.locator('.live-telemetry-dock').count(),0);assert.equal(await page.locator('.phone-readouts>div').count(),0);
  await tools('Camera');const buttons=page.locator('.camera-popover__grid>button');assert.equal(await buttons.count(),5);const boxes=await buttons.evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));assert.ok(boxes.every(b=>b.h<=80));assert.equal(boxes[0].y,boxes[1].y);await shot(label+'-camera');await buttons.first().click();await page.locator('.camera-popover').waitFor({state:'detached'});await page.waitForTimeout(1800);await shot(label+'-camera-applied');
 });
 await check(label+'-system-map-and-final-destination',async()=>{
  await tools('System');await page.locator('.phone-system-diagram svg').waitFor();assert.equal(await page.locator('.phone-system-diagram svg').getAttribute('preserveAspectRatio'),'xMidYMid meet');await shot(label+'-system-map');
  await page.getByRole('button',{name:'CATALOG',exact:true}).click();const view=page.locator('.system-menu__viewport'),last=page.locator('.system-catalog__row').last();await swipeList(view,context,label);assert.ok(await view.evaluate(n=>n.scrollTop>0));await last.scrollIntoViewIfNeeded();await shot(label+'-planets-last');
  await page.getByRole('button',{name:'ORBIT MAP',exact:true}).first().click();await page.locator('.phone-system-diagram svg').waitFor();await page.getByRole('button',{name:'CATALOG',exact:true}).click();await page.locator('.system-catalog__row').filter({hasText:'Earth'}).first().click();await page.locator('.system-menu').waitFor({state:'detached'});
 });
 await check(label+'-catalog-search-filter-and-inspector',async()=>{
  await page.getByRole('button',{name:'Open object explorer'}).click();const catalog=page.locator('.mobile-catalog');await catalog.waitFor();assert.equal(await catalog.locator('input[type=search]').count(),0);assert.ok(await page.evaluate(()=>document.activeElement?.tagName!=='INPUT'));
  const list=catalog.locator('.mobile-catalog__results');await swipeList(list,context,label);assert.ok(await list.evaluate(n=>n.scrollTop>0));await catalog.locator('.mobile-object-row').last().scrollIntoViewIfNeeded();await shot(label+'-satellites-last');
  await catalog.getByRole('button',{name:'Search objects',exact:true}).click();await catalog.getByRole('searchbox',{name:'Search objects'}).fill('25544');await page.setViewportSize({width:390,height:440});assert.ok(await list.evaluate(n=>n.clientHeight>60));await shot(label+'-search-keyboard-height');
  await catalog.getByRole('button',{name:/Filters/}).click();await catalog.getByLabel('Type',{exact:true}).selectOption('Stations');await catalog.getByRole('button',{name:'Apply filters'}).click();assert.match(await catalog.getByRole('button',{name:/Filters/}).innerText(),/1/);await catalog.getByRole('button',{name:'Done searching'}).click();await page.setViewportSize({width:390,height:844});
  await catalog.locator('.mobile-object-name').first().click();const inspector=page.locator('.phone-inspector.is-right');await inspector.waitFor();assert.equal(await page.locator('dialog:modal').count(),0);await shot(label+'-satellite');
  await inspector.getByRole('button',{name:'Minimize satellite inspector'}).click();await page.getByRole('button',{name:'Reopen satellite inspector'}).click();await inspector.getByRole('button',{name:'Details',exact:false}).click();await shot(label+'-satellite-details');await inspector.getByRole('button',{name:'Back to results'}).click();await catalog.waitFor();await catalog.getByRole('button',{name:'Search objects',exact:true}).click();assert.equal(await catalog.getByRole('searchbox').inputValue(),'25544');await catalog.getByRole('button',{name:'Close object explorer'}).click();
 });
 await check(label+'-earth-tap-nonmodal-and-pan',async()=>{
  await close();await page.setViewportSize({width:390,height:844});await page.keyboard.press('c');await page.locator('.camera-popover__grid>button').first().click();await page.waitForTimeout(2500);
  const canvas=page.locator('.cesium-widget canvas').first();if(label==='webkit'&&!await canvas.count()){assert.ok(await page.locator('.scene-error').isVisible());return {skip:'Windows WebKit cannot initialize the Cesium 3D scene; globe taps/pan require device validation.'};}await canvas.click({position:{x:195,y:350}});const weather=page.locator('.phone-inspector.is-left');await weather.waitFor({timeout:12000});assert.equal(await page.locator('dialog:modal').count(),0);await shot(label+'-weather');
  await page.mouse.move(130,320);await page.mouse.down();await page.mouse.move(210,340,{steps:12});await page.mouse.up();assert.ok(await weather.isVisible());await weather.getByRole('button',{name:'Minimize location weather'}).click();await page.getByRole('button',{name:'Reopen location weather'}).click();await weather.getByRole('button',{name:'Details',exact:false}).click();await shot(label+'-weather-details');await weather.getByRole('button',{name:'Save this location',exact:true}).click();const picker=page.locator('.mobile-location-picker');await picker.waitFor({timeout:60000});assert.equal(await picker.locator('.location-map-pin').count(),1);assert.equal(await picker.getByLabel('Location timezone',{exact:true}).inputValue(),'');await shot(label+'-weather-save-location');await picker.getByRole('button',{name:'Cancel',exact:true}).click();await close();
 });
 await check(label+'-independent-location-map',async()=>{
  await close();await page.getByRole('button',{name:'Open profile and settings'}).click();await page.getByRole('tab',{name:'My Skywatch',exact:true}).click();await page.getByRole('tab',{name:'Locations',exact:true}).click();await page.getByRole('button',{name:'Add location',exact:true}).click();
  const picker=page.locator('.mobile-location-picker');await picker.waitFor({timeout:60000});assert.equal(await picker.locator('input[type=number]').count(),0);await picker.getByRole('button',{name:'Set pin here'}).click();assert.equal(await picker.locator('.leaflet-interactive').count(),1);await picker.getByRole('button',{name:'Fit coverage'}).click();await picker.getByLabel('Location name',{exact:true}).fill('Mobile map QA');await picker.getByLabel('Location timezone',{exact:true}).fill('Asia/Kolkata');await picker.getByLabel('I confirm this location’s timezone').check();await shot(label+'-location-map');await picker.getByRole('button',{name:'Save location',exact:true}).scrollIntoViewIfNeeded();await picker.getByRole('button',{name:'Save location',exact:true}).click();await picker.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Edit Mobile map QA',exact:true}).click();await picker.waitFor();assert.ok(await picker.locator('.location-map-pin').count());await picker.getByRole('button',{name:'Fit coverage'}).click();await shot(label+'-location-edit');await picker.getByRole('button',{name:'Cancel',exact:true}).scrollIntoViewIfNeeded();await picker.getByRole('button',{name:'Cancel',exact:true}).click();await picker.waitFor({state:'detached'});await close();
  await page.getByRole('button',{name:'Open profile and settings'}).click();await page.getByRole('tab',{name:'My Skywatch',exact:true}).click();await page.getByRole('tab',{name:'Locations',exact:true}).click();await page.getByRole('button',{name:'Edit ISOLATED TEST observation point 1',exact:true}).click();await picker.waitFor();await picker.locator('.leaflet-tile-loaded').first().waitFor({timeout:15000});await page.waitForTimeout(1200);await shot(label+'-location-street-labels');
  const save=await picker.getByRole('button',{name:'Save location',exact:true}).boundingBox();assert.ok(save.y+save.height<=844);await picker.getByRole('button',{name:'Cancel',exact:true}).click();await close();
 });
 await check(label+'-time-mode-fixed-basemap',async()=>{
  await page.evaluate(()=>localStorage.setItem('orbitwatch_time_map','osm'));await page.getByTitle('Time Explorer mode',{exact:true}).click();await page.locator('.phone-time-strip').waitFor({timeout:60000});await page.locator('.time-preparation').waitFor({state:'hidden',timeout:60000});await shot(label+'-time-strip');
  await page.keyboard.press('m');await page.keyboard.press('c');assert.equal(await page.locator('.map-settings,.camera-popover').count(),0);
  await page.getByRole('button',{name:'Expand date and time controls'}).click();await page.getByRole('button',{name:'Scene date and time (local)'}).click();await page.locator('.scene-picker').waitFor();await shot(label+'-calendar');await page.getByRole('button',{name:'Use as draft'}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Use as draft'}).click();await page.getByRole('button',{name:'Back 60 minutes'}).click();await page.locator('.time-dock__load').click();await page.locator('.phone-time-strip').waitFor();await page.locator('.time-preparation').waitFor({state:'hidden',timeout:60000});await shot(label+'-time-loaded');
  await page.getByRole('button',{name:'Open object explorer'}).click();await page.locator('.mobile-object-row').last().scrollIntoViewIfNeeded();assert.equal(await page.locator('.mobile-object-row').count(),15);await shot(label+'-historical-last');await close();await tools('System');await page.getByRole('button',{name:'Close system menu'}).click();await page.getByTitle('Live mode',{exact:true}).click();
 });
 for(const [w,h] of [[320,568],[360,780],[412,915],[844,390],[780,360]])await check(`${label}-${w}x${h}`,async()=>{
  await close();await page.getByTitle('Live mode',{exact:true}).click();await page.setViewportSize({width:w,height:h});await shot(`${label}-${w}x${h}-globe`);assert.ok(await page.locator('.phone-tools').isVisible());await tools('Camera');await shot(`${label}-${w}x${h}-camera`);const closeButton=page.getByRole('button',{name:'Close camera menu'});const r=await closeButton.boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=w&&r.y+r.height<=h);await close();await tools('System');await page.getByRole('button',{name:'CATALOG',exact:true}).click();await page.locator('.system-catalog__row').last().scrollIntoViewIfNeeded();await shot(`${label}-${w}x${h}-last-planet`);await close();
 });
 await context.close();
}
