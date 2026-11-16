/* Actual app; synthetic cloud pattern and disposable accounts, never production. */
const {chromium}=require('../.setup-cache/browser-qa/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const out=path.resolve('.setup-cache/reliability');const results=process.env.ORBITWATCH_RELIABILITY_FILTER&&fs.existsSync(path.join(out,'focused-browser.json'))?JSON.parse(fs.readFileSync(path.join(out,'focused-browser.json'))).results:[],errors=[];
let browser;
async function check(name,work){if(process.env.ORBITWATCH_RELIABILITY_FILTER&&!process.env.ORBITWATCH_RELIABILITY_FILTER.split(',').includes(name))return;const old=results.findIndex(r=>r.name===name);if(old>=0)results.splice(old,1);try{await work();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});for(const context of browser.contexts())await context.close().catch(()=>{});}console.log(results.at(-1));fs.writeFileSync(path.join(out,'focused-browser.json'),JSON.stringify({results,errors},null,2));}
async function screenshot(page,name){await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});}
async function close(page){for(let i=0;i<6;i++){const b=page.locator('button[aria-label^="Close"]:visible').last();if(!await b.count())return;await b.click({timeout:1500}).catch(()=>page.keyboard.press('Escape'));await page.waitForTimeout(200);}}
async function session(viewport,touch=false){
 const context=await browser.newContext({viewport,isMobile:touch,hasTouch:touch,reducedMotion:'reduce'});
 const response=await context.request.post('http://127.0.0.1:8001/api/auth/login',{data:{username_or_email:'delivery_fixture1',password:'Disposable-delivery-2026'}});assert.equal(response.status(),200);
 const auth=await response.json();await context.addInitScript(token=>localStorage.setItem('orbitwatch_access_token',token),auth.access_token);
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));return {context,page};
}
async function ready(page){await page.goto('http://127.0.0.1:5174',{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'Open profile and settings'}).waitFor({timeout:60000});await page.locator('.boot-sequence').waitFor({state:'hidden',timeout:60000});await page.waitForTimeout(1500);}
async function weather(page,touch){if(touch){await page.getByRole('button',{name:'Tools',exact:true}).click();await page.getByRole('button',{name:'Weather',exact:true}).click();}else await page.getByRole('button',{name:'Weather',exact:true}).click();await page.locator('.weather-panel').waitFor();}
(async()=>{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [name,viewport,touch] of [['phone',{width:390,height:844},true],['desktop',{width:1600,height:900},false],['short-desktop',{width:1280,height:506},false]]){
  await check(name+'-cloud-version-quality-and-status',async()=>{
   const {context,page}=await session(viewport,touch);let images=0;const transfers=[];
   page.on('response',async response=>{if(response.url().includes('/infrared/frame?')){images++;const timing=response.request().timing();transfers.push({url:response.url().split('/api/')[1],status:response.status(),timing});}});
   await ready(page);await weather(page,touch);await page.waitForFunction(()=>{const n=document.querySelector('.observed-clouds');return n&&JSON.parse(n.dataset.cloudDiagnostics).cachedFrames>0;},{timeout:30000});
   await screenshot(page,name+'-weather-menu');assert.equal(await page.getByText('Weather at a location',{exact:true}).count(),0);
   const initial=images;await page.getByRole('button',{name:'CHECK LATEST OBSERVATION'}).click();await page.waitForTimeout(700);assert.equal(images,initial,'unchanged version must not redownload');
   const meta=JSON.parse(await page.locator('.observed-clouds').getAttribute('data-cloud-diagnostics'));
   await close(page);
   for(const quality of ['performance','balanced','quality']){
    await page.getByRole('button',{name:'Open profile and settings'}).click();await page.getByRole('tab',{name:'Profile',exact:true}).click();await page.getByLabel('Render quality',{exact:true}).selectOption(quality);await close(page);await page.waitForTimeout(900);
   }
   assert.ok(images<=initial+(touch?0:1),'quality changes reuse the two ready variants');
   await page.waitForTimeout(1000);const display=await page.locator('[data-weather-diagnostics]').first().getAttribute('data-weather-diagnostics');
   fs.writeFileSync(path.join(out,name+'-cloud-timings.json'),JSON.stringify({fixture:'synthetic prepared pattern',metadata:meta,transfers,display:display&&JSON.parse(display)},null,2));
   await page.getByRole('button',{name:'Open object explorer'}).click();const catalog=page.locator('.mobile-catalog');await catalog.waitFor();assert.notEqual(await page.locator(':focus').getAttribute('type'),'search');assert.ok(await catalog.locator('.mobile-object-row').count()>100);await catalog.locator('.mobile-object-row').last().scrollIntoViewIfNeeded();await screenshot(page,name+'-catalog-last');
   await catalog.getByRole('button',{name:'Search objects',exact:true}).click();await catalog.getByRole('searchbox').fill('ISS');await screenshot(page,name+'-catalog-search');assert.ok(await catalog.locator('.mobile-object-row').count()>0);await close(page);
   await page.getByTitle('Time Explorer mode',{exact:true}).click();await page.locator('.phone-time-strip').waitFor();await page.locator('.time-preparation').waitFor({state:'hidden',timeout:60000});const applied=await page.locator('.phone-time-strip').innerText();await page.getByRole('button',{name:'Expand date and time controls'}).click();await page.getByLabel('Year',{exact:true}).fill('2000');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('.phone-time-strip').innerText(),applied);await page.getByRole('button',{name:'Expand date and time controls'}).click();await page.getByLabel('Year',{exact:true}).fill('2000');await page.getByRole('button',{name:'Apply date & time'}).click();await page.locator('.time-preparation').waitFor({state:'hidden',timeout:60000});assert.match(await page.locator('.phone-time-strip').innerText(),/2000/);await screenshot(page,name+'-applied-date');await context.close();
  });
 }
 for(const [name,viewport,touch] of [['phone',{width:320,height:700},true],['desktop',{width:1280,height:720},false]]){
  await check(name+'-orbit-status-open-panel-recovery',async()=>{
   const {context,page}=await session(viewport,touch);let state='loading',release;const gate=new Promise(resolve=>release=resolve);
   await page.route('**/api/satellites/data-status*',async route=>{if(state==='loading')await gate;if(state==='offline')return route.abort('failed');if(state==='unavailable')return route.fulfill({status:503,json:{detail:'Isolated unavailable'}});return route.fulfill({json:{age_seconds:state==='stale'?900000:60,stale:state==='stale',missing_supported_objects:state==='partial'}});});
   await page.clock.install();await ready(page);if(touch)await page.getByRole('button',{name:'Readouts',exact:true}).click();
   await screenshot(page,name+'-feed-loading');state='current';release();await page.waitForTimeout(700);
   for(const value of ['current','partial','stale','offline','unavailable','current']){state=value;await page.clock.fastForward(61000);const status=touch?page.locator('.phone-readouts p[role="status"]'):page.locator('.feed-readout summary');await status.filter({hasText:value==='partial'?'Partial coverage':value[0].toUpperCase()+value.slice(1)}).waitFor();await screenshot(page,name+'-feed-'+value);}
   await context.close();
  });
 }
 await check('login-slow-verification-arm-and-safe-logout',async()=>{
  const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'no-preference'});const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));let verify;
  await page.route('**/api/auth/me',async route=>{await new Promise(resolve=>verify=resolve);await route.continue();});
  await page.goto('http://127.0.0.1:5174/login',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('.boot-sequence').waitFor({state:'hidden'});await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill('delivery_fixture1');await page.getByLabel('PASSWORD',{exact:true}).fill('wrong-password');await page.getByRole('button',{name:'LOGIN',exact:true}).click();await page.locator('.auth-form-message').waitFor();await screenshot(page,'login-failed');
  await page.getByLabel('PASSWORD',{exact:true}).fill('Disposable-delivery-2026');await page.getByRole('button',{name:'LOGIN',exact:true}).click();await page.getByText('Verifying your session…',{exact:true}).waitFor();assert.equal(await page.locator('.boot-sequence').count(),0);await screenshot(page,'login-verifying');verify();await page.locator('.auth-extraction-arm').waitFor();await screenshot(page,'login-arm');await page.getByRole('button',{name:'Open profile and settings'}).waitFor({timeout:60000});await page.waitForTimeout(2500);await page.getByRole('button',{name:'Open profile and settings'}).click();await page.getByRole('button',{name:'Logout',exact:true}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('orbitwatch_access_token')),null);assert.equal(await page.locator('.profile-panel').count(),0);await page.locator('.is-delivering .auth-extraction-arm').waitFor();await screenshot(page,'logout-arm');await page.getByRole('button',{name:'LOGIN',exact:true}).waitFor();await context.close();
 });
 await browser.close();assert.equal(errors.length,0,errors.join('\n'));assert.ok(results.every(r=>r.pass),'See focused-browser.json');
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
