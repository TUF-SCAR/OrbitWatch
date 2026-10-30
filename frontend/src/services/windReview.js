import { Cartesian3, Matrix4 } from 'cesium';
// Explicit dev-only native acceptance controls. No fixtures, APIs, or auth bypass.
export function mountWindReview(viewer, mount, getField, touch) {
  const bar=document.createElement('div');bar.setAttribute('aria-label','Wind verification');
  bar.style.cssText='position:absolute;z-index:99;bottom:120px;right:16px;display:flex;flex-wrap:wrap;max-width:330px;gap:4px;padding:6px;background:#07101e';
  let recorder=null,stream=null,stopTimer=null,disposed=false,url=null;
  // Review-only: retain the chosen camera while waiting for provider imagery.
  const holdView=setInterval(touch,1000);
  const add=(label,action)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='font:11px sans-serif;padding:6px;background:#102c39;color:white;border:1px solid #427484';b.onclick=action;bar.append(b);return b;};
  const view=(lon,lat,height)=>{touch();viewer.camera.lookAtTransform(Matrix4.IDENTITY);viewer.camera.flyTo({destination:Cartesian3.fromDegrees(lon,lat,height),orientation:{heading:0,pitch:-Math.PI/2,roll:0},duration:.6});};
  add('Indian Ocean',()=>view(78,4,3000000));
  add('Bay of Bengal',()=>view(85,15,1100000));
  for(const km of [275,250,225,200,175])add(`${km} km`,()=>view(85,15,km*1000));
  add('North Atlantic',()=>view(-65,40,3000000));
  add('Dateline',()=>view(180,15,3500000));
  add('Whole Earth',()=>view(78,4,22000000));
  for(const high of [true,false])add(high?'High wind':'Low wind',()=>{
    const f=getField();if(!f?.u)return;
    let best=-1,score=Infinity;
    for(let y=35;y<145;y++)for(let x=0;x<360;x++){
      const i=y*360+x;if(f.u[i]===null||f.v[i]===null)continue;
      const speed=Math.hypot(f.u[i],f.v[i]),s=high?-speed:Math.abs(speed-2);
      if(s<score){score=s;best=i;}
    }
    if(best>=0){view(best%360-180,90-Math.floor(best/360),2500000);bar.dataset.sample=JSON.stringify({longitude:best%360-180,latitude:90-Math.floor(best/360),u:f.u[best],v:f.v[best],valid:f.valid_at});}
  });
  const record=add('Record 8s',()=>{
    if(recorder||!viewer.scene.canvas.captureStream||!window.MediaRecorder)return;
    touch();const chunks=[];stream=viewer.scene.canvas.captureStream(30);
    recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:5000000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;if(disposed)return;
      if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
      const a=document.createElement('a');a.href=url;a.download='orbitwatch-wind.webm';a.textContent='Save wind recording';a.style.color='#8ee9ff';bar.append(a);record.textContent='Record 8s';record.disabled=false;
    };
    recorder.start();record.textContent='Recording';record.disabled=true;
    stopTimer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();stopTimer=null;},8000);
  });
  mount.append(bar);
  return()=>{disposed=true;clearInterval(holdView);if(stopTimer)clearTimeout(stopTimer);if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());if(url)URL.revokeObjectURL(url);bar.remove();};
}
