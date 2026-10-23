// The ground scattering pass adds sunlight to the already-coloured imagery.
// Keep ground atmosphere's night attenuation, sky limb, fog and real sunlight.
export function createWeatherPresentation(scene) {
  let previous=null;
  return {
    set(active,strength=1) {
      if(active&&scene.globe){
        previous ||= {intensity:scene.globe.atmosphereLightIntensity};
        const original=previous.intensity??10;
        scene.globe.atmosphereLightIntensity=original+(Math.min(original,1)-original)*Math.max(0,Math.min(1,strength));
      }
      else if(!active&&previous){if(scene.globe)scene.globe.atmosphereLightIntensity=previous.intensity;previous=null;}
    },
    destroy(){this.set(false);},
  };
}

// Native-browser acceptance harness, mounted only by the DEV ?weatherCompare
// route. Explicit controls keep comparisons observable without hidden globals.
export function mountWeatherComparison(scene,mount){
  const bar=document.createElement('div');bar.setAttribute('aria-label','Weather atmosphere comparison');
  bar.style.cssText='position:absolute;z-index:99;bottom:112px;right:18px;display:flex;gap:5px;background:#07101e;padding:8px';
  const original={ground:scene.globe.showGroundAtmosphere,intensity:scene.globe.atmosphereLightIntensity,lighting:scene.globe.enableLighting,fog:scene.fog.enabled};
  for(const [label,ground,intensity,lighting,fog] of [['Original haze',true,10,true,true],['Reduced haze',true,1,true,true],['No ground haze',false,10,true,true],['No fog',true,10,true,false],['No sunlight',true,10,false,true]]){
    const button=document.createElement('button');button.textContent=label;button.style.cssText='color:#d1e9ee;background:#142231;border:1px solid #457080;padding:8px;font:12px sans-serif';
    button.onclick=()=>{scene.globe.showGroundAtmosphere=ground;scene.globe.atmosphereLightIntensity=intensity;scene.globe.enableLighting=lighting;scene.fog.enabled=fog;scene.requestRender();};bar.append(button);
  }
  mount.append(bar);
  return ()=>{bar.remove();if(scene.globe){scene.globe.showGroundAtmosphere=original.ground;scene.globe.atmosphereLightIntensity=original.intensity;scene.globe.enableLighting=original.lighting;}scene.fog.enabled=original.fog;};
}
