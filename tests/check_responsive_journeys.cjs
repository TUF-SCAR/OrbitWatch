/* Actual Vite/AuthRoot/App journeys; use disposable :8001 backend only. */
const {chromium}=require('../.setup-cache/browser-qa/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const out=path.resolve('.setup-cache/responsive-qa');
const results=[],errors=[],wms=[];let browser,page;
async function screenshot(name){await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});}
async function check(name,work){try{await work();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});await screenshot(name+'-failed').catch(()=>{});}await closePanels().catch(()=>{});fs.writeFileSync(path.join(out,'journeys.json'),JSON.stringify({results,errors,wms},null,2));console.log(name,results.at(-1).passed?'PASS':results.at(-1).error);}
async function closePanels(){for(let i=0;i<4;i++){const close=page.locator('button[aria-label^="Close"]:visible').last();if(!await close.count())return;await close.click();await page.waitForTimeout(100);}}
(async()=>{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const guest=await browser.newContext({viewport:{width:320,height:568},reducedMotion:'reduce'});
 page=await guest.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5174/login',{waitUntil:'domcontentloaded',timeout:60000});
 await check('auth-small-login-error',async()=>{
  await page.getByPlaceholder('Username or email').fill('missing_qa_user');await page.getByPlaceholder('Minimum 8 characters').fill('Isolated-wrong-password');
  await page.locator('button[type=submit]').click();await page.locator('#auth-form-error').waitFor();assert.match(await page.locator('#auth-form-error').innerText(),/invalid|incorrect|credentials/i);
  const submit=page.locator('button[type=submit]');await submit.scrollIntoViewIfNeeded();const box=await submit.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=568);await screenshot('auth-320-login-error');
 });
 await check('auth-register-short-viewport',async()=>{
  await page.getByRole('button',{name:'CREATE ACCOUNT',exact:true}).click();await page.setViewportSize({width:780,height:360});
  await page.getByPlaceholder('Choose a username').fill('responsive_'+Date.now().toString(36));await page.getByPlaceholder('you@example.com').fill('responsive-'+Date.now()+'@example.com');
  await page.getByPlaceholder('Minimum 8 characters').fill('Isolated-responsive-2026');await page.getByPlaceholder('Repeat your password').fill('Isolated-responsive-2026');
  await page.locator('button[type=submit]').scrollIntoViewIfNeeded();await screenshot('auth-780-register');await page.locator('button[type=submit]').click();
  await page.getByRole('button',{name:'Open profile and settings'}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'Open profile and settings'}).click();await page.getByRole('button',{name:'Logout',exact:true}).click();await page.getByPlaceholder('Username or email').waitFor({timeout:30000});
  assert.equal(await page.evaluate(()=>localStorage.getItem('orbitwatch_access_token')),null);
 });
 await guest.close();
 const context=await browser.newContext({storageState:path.join(out,'auth.json'),viewport:{width:390,height:844},reducedMotion:'reduce'});
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('eumetsat.int/geoserver'))wms.push(r.url());});
 page.on('response',async response=>{if(response.url().includes('/api/weather/infrared/current'))console.log('IR metadata',response.status(),await response.json().catch(()=>null));});
 await page.goto('http://127.0.0.1:5174',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'Open profile and settings'}).waitFor({timeout:60000});
 await check('catalogue-collection-inspector',async()=>{
  await page.getByRole('button',{name:'Open object explorer'}).click();const explorer=page.locator('.object-explorer');await explorer.locator('.search-field input').fill('25544');
  await explorer.getByRole('button',{name:/Add ISS.*to collection/}).click();const chooser=page.locator('.collection-chooser');assert.ok(await chooser.evaluate(e=>e.matches(':modal')));
  await chooser.locator('input').fill('QA long collection name for small screens');await chooser.getByRole('button',{name:'CREATE',exact:true}).click();await chooser.waitFor({state:'detached'});
  await explorer.locator('.object-row__main').first().click();await page.locator('.inspector-panel').waitFor();await screenshot('390x844-inspector');
  const photo=page.getByRole('button',{name:'2D PHOTO',exact:true});if(await photo.count())await photo.click();await closePanels();
 });
 await check('skywatch-locations-and-notifications',async()=>{
  await page.getByRole('button',{name:'Open profile and settings'}).click();await page.getByRole('tab',{name:'My Skywatch',exact:true}).click();
  for(const label of ['Planets / Moon','Events','Locations']){await page.getByRole('tab',{name:label,exact:true}).click();await screenshot('390x844-skywatch-'+label.split(' ')[0].toLowerCase());}
  await page.getByRole('tab',{name:'Notifications',exact:true}).click();await screenshot('390x844-notification-journey');
  const more=page.locator('.inbox-card summary').first();if(await more.count()){await more.click();await screenshot('390x844-notification-details');}
  await page.getByRole('tab',{name:'Preferences',exact:true}).click();await page.locator('.profile-panel .hud-panel__body').evaluate(e=>e.scrollTo({top:e.scrollHeight,behavior:'instant'}));await screenshot('390x844-preferences-bottom');await closePanels();
 });
 await check('genuine-observed-clouds',async()=>{
  await page.getByRole('button',{name:'Weather',exact:true}).click();await page.locator('.observed-clouds').waitFor();
  await page.getByRole('checkbox',{name:'Weather layer',exact:true}).check();
  const compatible=page.getByRole('button',{name:'USE ESRI FOR WEATHER',exact:true});if(await compatible.count())await compatible.click();
  await page.locator('.observed-clouds').scrollIntoViewIfNeeded();
  console.log('IR view',await page.locator('.observed-clouds').innerText());
  await page.locator('.observed-clouds .weather-valid').waitFor({timeout:45000});
  const text=await page.locator('.observed-clouds').innerText();assert.ok(text.includes('Composite observation'),'a genuine recorded observation must display');assert.ok(text.includes('CC BY 4.0'));assert.ok(!text.includes('PLAY OBSERVATIONS'));
  assert.ok(!text.includes('Retrieval time unavailable'),'retrieval timestamp must survive browser CORS');await page.locator('.observed-clouds').scrollIntoViewIfNeeded();await screenshot('390x844-infrared-details');await closePanels();await page.waitForTimeout(15000);await screenshot('390x844-infrared-globe');assert.equal(wms.length,0);
 });
 await check('mobile-place-search',async()=>{
  await page.getByRole('button',{name:'Search a place or address'}).click();const input=page.locator('.place-search input');await input.fill('Hyderabad');await screenshot('390x844-place-search');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Search a place or address');assert.equal(await input.count(),0);
 });
 await check('mobile-time-calendar-history',async()=>{
  await closePanels();await page.getByTitle('Time Explorer mode',{exact:true}).click();await page.getByRole('button',{name:'Scene date and time (local)'}).waitFor({timeout:60000});await screenshot('390x844-time-journey');
  await page.getByRole('button',{name:'Scene date and time (local)'}).click();const picker=page.locator('.scene-picker');await picker.waitFor();await picker.getByRole('button',{name:'Available history',exact:false}).click();await screenshot('390x844-calendar-history');await picker.getByRole('button',{name:'Use as draft'}).scrollIntoViewIfNeeded();await picker.getByRole('button',{name:'Use as draft'}).click();
  await page.getByRole('button',{name:'Historical weather',exact:true}).click();await page.locator('.historical-weather-panel').waitFor();await screenshot('390x844-historical-weather');await closePanels();
  await page.locator('.time-preparation').waitFor({state:'hidden',timeout:30000});await screenshot('390x844-time-journey');await page.getByRole('button',{name:'Return to Live Mode',exact:true}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Return to Live Mode',exact:true}).click();await page.getByRole('button',{name:'Weather',exact:true}).waitFor({timeout:60000});
 });
 await check('emulated-low-end-profile',async()=>{
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});await page.getByRole('button',{name:'Open profile and settings'}).click();await page.getByRole('tab',{name:'Notifications',exact:true}).click();await screenshot('390x844-cpu-throttle-notifications');await closePanels();await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach();
 });
 assert.equal(wms.length,0);await context.close();await browser.close();console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,errors}));process.exitCode=results.some(r=>!r.passed)||errors.length?1:0;
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
