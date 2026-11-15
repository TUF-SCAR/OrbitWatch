/* Run after: local fixture backend :8001, Vite :5174 and isolated browser login.
 * Tooling stays in ignored .setup-cache/browser-qa; no production credentials. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('../.setup-cache/browser-qa/node_modules/playwright');
const out=path.resolve('.setup-cache/responsive-qa');fs.mkdirSync(out,{recursive:true});
const sizes=process.env.QA_VIEWPORTS?process.env.QA_VIEWPORTS.split(',').map(size=>size.split('x').map(Number)):[[320,568],[360,780],[390,844],[412,915],[780,360],[768,1024],[1024,768],[769,506],[1280,720],[1600,900],[1920,1080]];
const results=[],errors=[],requests=[];let page,browser;
async function shot(name){await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});}
async function run(name,work){try{await work();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});await shot(name.replace(/[^a-z0-9-]/gi,'-')+'-failed').catch(()=>{});const close=page.locator('button[aria-label^="Close"]:visible').last();if(await close.count())await close.click().catch(()=>{});}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,requests},null,2));console.log(name,results.at(-1).passed?'PASS':results.at(-1).error);}
async function panelGeometry(selector){
 const p=page.locator(selector).last();await p.waitFor();
 const geometry=await p.evaluate(e=>{const r=e.getBoundingClientRect(),body=e.querySelector('.hud-panel__body')||e.querySelector('.system-menu__viewport');return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height,bodyHeight:body?.clientHeight,overflow:e.scrollWidth>e.clientWidth+2};});
 const {width,height}=page.viewportSize();assert.ok(geometry.x>=-1&&geometry.y>=-1&&geometry.right<=width+1&&geometry.bottom<=height+1,JSON.stringify(geometry));assert.ok(!geometry.overflow,'horizontal panel overflow');assert.ok(geometry.bodyHeight>=80,'content area must remain usable');
 const close=p.getByRole('button',{name:/Close/}).first();await close.scrollIntoViewIfNeeded();const rect=await close.boundingBox();assert.ok(rect&&rect.y>=0&&rect.y+rect.height<=height+1,'close is reachable');
 const body=p.locator('.hud-panel__body').first();if(await body.count()){await body.evaluate(e=>e.scrollTo({top:e.scrollHeight,behavior:'instant'}));await page.waitForTimeout(200);await body.evaluate(e=>e.scrollTo({top:e.scrollHeight,behavior:'instant'}));const scroll=await body.evaluate(e=>({height:e.scrollHeight,top:e.scrollTop,client:e.clientHeight}));assert.ok(scroll.height-scroll.top-scroll.client<3,'bottom of scroll region reachable '+JSON.stringify(scroll));await body.evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));}
 return p;
}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:[]});
 const context=await browser.newContext({storageState:path.join(out,'auth.json'),viewport:{width:769,height:506},reducedMotion:'reduce'});
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('eumetsat.int/geoserver'))requests.push(r.url());});
 await page.goto('http://127.0.0.1:5174',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'Open profile and settings'}).waitFor({timeout:60000});await page.waitForTimeout(20000);
 for(const [width,height] of sizes){
  const size=`${width}x${height}`;await page.setViewportSize({width,height});await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForTimeout(500);
  await run(`${size}-live`,async()=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   for(const selector of ['.mode-rail','.scene-dock','.live-dock','.explorer-trigger','.presentation-toggle','.manual-refresh']){
    const e=page.locator(selector);if(!await e.count()||!await e.isVisible())continue;
    // HUD assembly recomputes its footprint in ResizeObserver after orientation.
    // Assert the settled result; persistent offscreen controls still fail.
    await page.waitForFunction(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return r.x>=-2&&r.y>=-2&&r.right<=innerWidth+2&&r.bottom<=innerHeight+2;},selector,{timeout:5000});
    const r=await e.boundingBox();assert.ok(r.x>=-2&&r.y>=-2&&r.x+r.width<=width+2&&r.y+r.height<=height+2,selector+JSON.stringify(r));
   }
   await shot(`${size}-live`);
  });
  await run(`${size}-profile`,async()=>{
   await page.getByRole('button',{name:'Open profile and settings'}).click();await page.getByRole('tab',{name:'Profile',exact:true}).click();await panelGeometry('.profile-panel');
   assert.ok(await page.locator('.profile-panel').evaluate(e=>e.matches(':modal')),'true modal semantics');
   await shot(`${size}-profile`);
   for(const label of ['My Skywatch','Notifications','Preferences']){await page.getByRole('tab',{name:label,exact:true}).click();await panelGeometry('.profile-panel');await shot(`${size}-${label.toLowerCase().replace(' ','-')}`);}
   await page.keyboard.press('Tab');assert.ok(await page.locator('.profile-panel').evaluate(e=>e.contains(document.activeElement)),'focus stays inside dialog');
   await page.keyboard.press('Escape');await page.locator('.profile-panel').waitFor({state:'detached'});assert.ok(await page.getByRole('button',{name:'Open profile and settings'}).evaluate(e=>e===document.activeElement),'focus returns to opener');
  });
  for(const [key,selector] of [['w','.weather-panel'],['m','.map-settings'],['c','.camera-popover'],['s','.system-menu'],['/','.object-explorer']]){
   await run(`${size}-${key==='/'?'objects':key}`,async()=>{await page.keyboard.press(key);const panel=await panelGeometry(selector);if(key==='s'){await panel.getByRole('button',{name:'CATALOG',exact:true}).click();}await shot(`${size}-${key==='/'?'objects':key}`);await panel.getByRole('button',{name:/Close/}).first().click();});
   if(await page.locator('dialog:modal').count())await page.keyboard.press('Escape');
  }
 }
 await page.setViewportSize({width:390,height:844});
 await run('390x844-time',async()=>{
  await page.getByTitle('Time Explorer mode',{exact:true}).click();await page.getByRole('button',{name:'Scene date and time (local)'}).waitFor({timeout:60000});await shot('390x844-time');
  await page.getByRole('button',{name:'Scene date and time (local)'}).click();const picker=page.locator('.scene-picker');await picker.waitFor();await picker.getByRole('button',{name:'Use as draft'}).scrollIntoViewIfNeeded();await shot('390x844-calendar');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Return to Live Mode',exact:true}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Return to Live Mode',exact:true}).click();await page.getByRole('button',{name:'Open profile and settings'}).waitFor({timeout:60000});
 });
 // Keyboard-open equivalent: usable content at 390x440. CSS zoom equivalents are
 // included in the 769/780 CSS viewports; no device-scale-factor substitution.
 await page.setViewportSize({width:390,height:440});await run('keyboard-profile',async()=>{await page.getByRole('button',{name:'Open profile and settings'}).click();await panelGeometry('.profile-panel');await shot('keyboard-profile');await page.keyboard.press('Escape');});
 assert.equal(requests.length,0,'browser must never contact WMS');
 console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,errors}));
 await browser.close();process.exitCode=results.some(r=>!r.passed)||errors.length?1:0;
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
