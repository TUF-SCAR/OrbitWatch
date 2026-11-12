// Isolated visual review using a READ-ONLY COPY of an existing genuine cache.
// No API/auth/storage clients or weather-provider downloads. Explicit buttons
// replace the precipitation plane with labeled synthetic classification fixtures.
import {createRoot} from 'react-dom/client';
import {Cartesian3,Color,Math as CesiumMath,ScreenSpaceEventHandler,ScreenSpaceEventType,Viewer} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import '../src/components/WeatherPanel.css';
import WeatherScale from '../src/components/WeatherScale.jsx';
import {selectWeatherField} from '../src/services/weatherFields.js';
import {createTemperatureLayer,temperatureProvider} from '../src/services/temperatureLayer.js';
import {createPressureLayer} from '../src/services/pressureLayer.js';
import {createWeatherHover} from '../src/services/weatherHover.js';
import {createWeatherCompute} from '../src/services/weatherCompute.js';
import {mountWeatherAltitudeFade,weatherAltitudeAlpha} from '../src/services/weatherVisibility.js';
import {pickEarthLocation} from '../src/services/earthWeatherPicking.js';



const style=document.createElement('style');style.textContent=`
:root{--ui-text:#eaf2f6;--ui-text-muted:#b9c9d2;--line:#ffffff20;--panel:#0c1723ed;--accent:#9de4e1;--ui-font-xs:10px}
*{box-sizing:border-box}body{margin:0;background:#07101b;color:#eaf2f6;font:13px system-ui}#globe{position:absolute;inset:0}nav{position:absolute;z-index:40;top:12px;left:12px;right:12px;padding:12px 16px;border:1px solid #ffffff20;border-radius:12px;background:#101d29ec;display:grid;gap:9px}nav strong{font-size:11px;letter-spacing:.12em}nav div{display:flex;gap:6px;flex-wrap:wrap;align-items:center}nav button{background:#243645;color:#ebf4f8;border:1px solid #ffffff24;border-radius:5px;padding:7px 11px;cursor:pointer}nav button[aria-pressed=true]{border-color:#9de4e1;color:#b1ffed}nav label{padding:0 8px}output{font-size:10px;color:#b9c9d2;white-space:pre-wrap}#legend{left:22px;bottom:32px;--ui-content-left:22px}#panel{position:absolute;z-index:32;right:18px;top:200px;width:300px;padding:20px;background:#101c2af5;border:1px solid #ffffff25;border-radius:12px}#panel p{font-size:12px;line-height:1.6;color:#b9c9d2}#panel[hidden]{display:none}@media(max-width:600px){nav{padding:8px}nav button{font-size:11px;padding:6px}#panel{top:230px;width:270px}#legend{right:22px;width:auto}}
`;document.head.append(style);
const mount=document.querySelector('#globe'),status=document.querySelector('#status');
const viewer=new Viewer(mount,{baseLayer:false,baseLayerPicker:false,geocoder:false,timeline:false,animation:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,requestRenderMode:true,maximumRenderTimeChange:Infinity});
viewer.scene.globe.baseColor=Color.fromCssColorString('#102e42');viewer.scene.globe.enableLighting=false;viewer.clock.shouldAnimate=false;

const response=await fetch('/@fs/C:/Code/OrbitWatch/.setup-cache/live-weather-review.json');if(!response.ok)throw Error('Read-only local review bundle missing');
let bundle=await response.json();const genuine=bundle;let field=null,enabled=true,held=false,mouse=true,buildMs=0,panelOpen=false,fixturePhase=null;
const compute=createWeatherCompute();
const raster=createTemperatureLayer(viewer,{makeProvider:async(data,quality)=>{const start=performance.now();const pixels=await compute.raster(data,1440,720);const provider=temperatureProvider(data,quality,pixels);buildMs=performance.now()-start;return provider;},reduced:()=>true});
const pressure=createPressureLayer(viewer,{compute});
const hover=createWeatherHover({mount,canvas:viewer.scene.canvas,getState:()=>({field,enabled:enabled&&weatherAltitudeAlpha(viewer.camera.positionCartographic.height)>0,dragging:held||!mouse}),pickLocation:position=>pickEarthLocation(viewer,position,null)});
const legend=createRoot(document.querySelector('#legend')),panelScale=createRoot(document.querySelector('#panel-scale'));
const handler=new ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction(movement=>hover.move(movement.endPosition,viewer.scene.pick(movement.endPosition)),ScreenSpaceEventType.MOUSE_MOVE);
const down=()=>{held=true;hover.hide();},up=()=>{held=false;},move=event=>{mouse=event.pointerType==='mouse';},wheel=()=>hover.hide();
viewer.scene.canvas.addEventListener('pointerdown',down);viewer.scene.canvas.addEventListener('pointermove',move);viewer.scene.canvas.addEventListener('wheel',wheel);window.addEventListener('pointerup',up);
const removeFade=mountWeatherAltitudeFade(viewer,()=>[raster,pressure]);
let last=0;
const removeFrame=viewer.scene.preRender.addEventListener(()=>{
  const time=performance.now();
  if(time-last<500)return;last=time;
  status.textContent=`${fixturePhase?`ISOLATED PHASE FIXTURE · 3 mm/h · ${fixturePhase}`:`Genuine cached GFS · valid ${bundle.valid_at}`} · 1° source / 1440px display · texture ${buildMs.toFixed(1)} ms\n${JSON.stringify({field:field?.display_variable||'temperature',pressure:pressure.diagnostics(),hover:hover.diagnostics()})}`;
});
function update(variable=field?.display_variable||'temperature'){
  hover.hide();field=selectWeatherField(bundle,variable);
  raster.update({field,visible:enabled,quality:'balanced',opacity:.68,immediate:true});pressure.update({field,visible:enabled,opacity:.68});
  for(const button of document.querySelectorAll('[data-field]'))button.setAttribute('aria-pressed',String(button.dataset.field===variable));
  legend.render(<><WeatherScale variable={variable} field={field}/><small>{fixturePhase?`ISOLATED FIXTURE · ${fixturePhase} · 3 mm/h`:`NOAA/NCEP GFS · 1° · ${bundle.valid_at}`}</small>{variable==='precipitation'&&<small>Liquid equivalent · nearest categorical nodes{fixturePhase?' · synthetic phase':' · GFS model clouds'}</small>}</>);
  panelScale.render(<WeatherScale variable={variable} field={field}/>);viewer.scene.requestRender();
}
for(const button of document.querySelectorAll('[data-field]'))button.onclick=()=>update(button.dataset.field);
document.querySelector('#overlay').onchange=event=>{enabled=event.target.checked;update();};
document.querySelector('#panel-toggle').onclick=event=>{panelOpen=!panelOpen;document.querySelector('#panel').hidden=!panelOpen;document.querySelector('#legend').hidden=panelOpen;event.target.textContent=panelOpen?'Close weather panel':'Open weather panel';hover.hide();};
const regional=()=>viewer.camera.setView({destination:Cartesian3.fromDegrees(86,28,6500000),orientation:{heading:0,pitch:-CesiumMath.PI_OVER_TWO,roll:0}});
document.querySelector('#regional').onclick=regional;
document.querySelector('#global').onclick=()=>viewer.camera.setView({destination:Cartesian3.fromDegrees(75,10,19000000)});
document.querySelector('#dateline').onclick=()=>viewer.camera.setView({destination:Cartesian3.fromDegrees(180,30,6500000)});
regional();update();
import.meta.hot?.dispose(()=>{hover.destroy();removeFade();removeFrame();handler.destroy();raster.destroy();pressure.destroy();compute.destroy();legend.unmount();panelScale.unmount();viewer.scene.canvas.removeEventListener('pointerdown',down);viewer.scene.canvas.removeEventListener('pointermove',move);viewer.scene.canvas.removeEventListener('wheel',wheel);window.removeEventListener('pointerup',up);viewer.destroy();style.remove();});

const phases=['rain','snow','freezing_rain','ice_pellets','mixed','unknown'];
const phaseButtons=document.createElement('div');
for(const phase of phases){const button=document.createElement('button');button.textContent=`Fixture: ${phase}`;button.onclick=()=>{fixturePhase=phase;bundle={...genuine,id:`phase-fixture-${phase}`,fields:{...genuine.fields,precipitation:{...genuine.fields.precipitation,values:Array(65160).fill(3)}},precipitation_phase:{...genuine.precipitation_phase,values:Array(65160).fill(phase)}};update('precipitation');};phaseButtons.append(button);}
document.querySelector('nav').append(phaseButtons);
