/* Own the isolated servers for the entire browser run; await health before UI. */
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.setup-cache/responsive-qa');
const servers=[];fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(root,'.setup-cache/responsive-vite.config.mjs'),`import original from '../frontend/vite.config.js';
import {fileURLToPath} from 'node:url';
export default {...original,root:fileURLToPath(new URL('../frontend/',import.meta.url)),cacheDir:fileURLToPath(new URL('./responsive-app-vite/',import.meta.url)),server:{host:'127.0.0.1',port:5174,strictPort:true}};
`);
function start(executable,args,cwd,env,name){
 const child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});servers.push(child);
 child.stdout.pipe(fs.createWriteStream(path.join(out,name+'.log')));child.stderr.pipe(fs.createWriteStream(path.join(out,name+'-errors.log')));return child;
}
function cleanup(){for(const child of servers){if(child.pid){if(process.platform==='win32')spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');}}}
async function ready(url){for(let i=0;i<240;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Isolated QA service did not become ready: '+url);}
async function test(file){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{cwd:root,env:process.env,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(file+' exited '+code)));});}
process.on('SIGINT',()=>{cleanup();process.exit(130);});process.on('SIGTERM',()=>{cleanup();process.exit(143);});
(async()=>{
 const selection=process.argv[2]||'all';if(!['all','grid','journeys','mobile','reliability'].includes(selection))throw Error('Choose all, grid, journeys, mobile or reliability');
 start(path.join(root,'backend/.venv/Scripts/python.exe'),['tests/check_notification_delivery.py','--serve'],root,{...process.env,ORBITWATCH_QA_INFRARED_CACHE:path.join(root,'.setup-cache/infrared-provider-qa')},'owned-backend');
 start(process.execPath,['node_modules/vite/bin/vite.js','--config',path.join(root,'.setup-cache/responsive-vite.config.mjs')],path.join(root,'frontend'),{...process.env,VITE_API_BASE_URL:'http://127.0.0.1:8001',VITE_CESIUM_ION_TOKEN:''},'owned-vite');
 await Promise.all([ready('http://127.0.0.1:8001/health/live'),ready('http://127.0.0.1:5174')]);
 if(servers.some(child=>child.exitCode!==null))throw Error('A QA server exited; inspect the owned server logs instead of reusing another process');
 console.log('Isolated backend and actual Vite application are ready');
 if(selection==='reliability')await test('tests/check_reliability_ui.cjs');
 else if(selection==='mobile')await test('tests/check_mobile_ui.cjs');
 else {
 if(selection!=='journeys')await test('tests/check_responsive.cjs');
 if(selection!=='grid')await test('tests/check_responsive_journeys.cjs');
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(cleanup);
