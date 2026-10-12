import assert from "node:assert/strict";
import test from "node:test";
import { Cartesian3, JulianDate, Matrix3, Matrix4, PrimitiveCollection } from "cesium";
import { ALL_CELESTIAL_IDS } from "../src/data/celestialBodies.js";
import { generatePopulation, generateStars, POPULATION_CAPS, POPULATION_KINDS, populationQuality, seededRandom } from "../src/data/proceduralPopulations.js";
import { createProceduralPopulationLayer, populationDensity, populationPrimitive, populationVisibility } from "../src/services/proceduralPopulationLayer.js";
import { starCubeProjection } from "../src/services/spaceBackground.js";
import { AU_METERS, bodyPositionFixed, inertialToFixedMatrix } from "../src/data/solarSystemEphemeris.js";

test("versioned seed reproduces bounded quality prefixes without real catalogue identities", () => {
  for (const kind of POPULATION_KINDS) {
    const performance=generatePopulation(kind,"performance"), balanced=generatePopulation(kind), quality=generatePopulation(kind,"quality");
    assert.deepEqual(generatePopulation(kind).positions,balanced.positions);
    assert.deepEqual(performance.positions,quality.positions.subarray(0,performance.positions.length));
    assert.deepEqual(balanced.styles,quality.styles.subarray(0,balanced.styles.length));
    assert.notDeepEqual(generatePopulation(kind,"balanced","changed-seed").positions,balanced.positions);
    assert.ok(!ALL_CELESTIAL_IDS.includes(kind));
    assert.equal(balanced.representative,true); assert.equal(balanced.id,undefined);
    assert.equal(balanced.count,POPULATION_CAPS.balanced[POPULATION_KINDS.indexOf(kind)]);
  }
  assert.equal(POPULATION_CAPS.quality.reduce((a,b)=>a+b),6240);
  assert.equal(populationQuality("auto",4),"performance"); assert.equal(populationQuality("auto",8),"balanced");
  const rng=seededRandom("orbitwatch-solar-v1");
  assert.deepEqual(Array.from({length:3},()=>rng()),[0.5300836726091802,0.1310247245710343,0.1065891282632947]);
});

test("orbital parameters stay in sourced representative regions, with finite inclined eccentric positions", () => {
  for (const kind of POPULATION_KINDS) {
    const data=generatePopulation(kind,"quality");
    for (let n=0;n<data.count;n++) {
      const [a,e,i]=data.elements.subarray(n*6,n*6+3);
      assert.ok([...data.positions.subarray(n*3,n*3+3),a,e,i,...data.styles.subarray(n*4,n*4+4)].every(Number.isFinite));
      assert.ok(e>0 && e<1 && i>0);
      if (kind === "main-belt") assert.ok(a>=2.2 && a<=3.3 && i<=24*Math.PI/180);
      if (kind === "kuiper") assert.ok(a*(1-e)>=30-1e-8 && a*(1+e)<=50+1e-8);
      if (kind === "scattered") assert.ok(a*(1-e)>=30 && a*(1-e)<=38 && a*(1+e)<=150);
      if (kind === "trojans") {
        const angle=Math.atan2(data.positions[n*3+1],data.positions[n*3]);
        assert.ok(Math.abs(Math.abs(angle)-Math.PI/3)<.55,"two bounded L4/L5 clouds, not a ring");
      }
    }
    assert.ok(new Set(data.elements.filter((_,i)=>i%6===1)).size>100,"varied eccentricities");
  }
});

test("population LOD is continuous, lazy, excludes close views and permits a stronger outer Kuiper context", () => {
  for (const kind of POPULATION_KINDS) {
    assert.equal(populationVisibility(kind,0.0002,0),0);
    let before=0;
    for (let range=.001;range<=240;range*=1.04) {
      const alpha=populationVisibility(kind,range,1);
      assert.ok(alpha>=before && alpha<=1 && alpha-before<.1); before=alpha;
    }
  }
  assert.ok(populationVisibility("kuiper",8,1,true)>populationVisibility("kuiper",8,1,false));
  assert.equal(populationDensity("main-belt",14,1),1);
  assert.equal(populationDensity("main-belt",240,1),.06,"overview retains a readable sparse inner belt without saturation");
  assert.ok(populationDensity("kuiper",240,1)>populationDensity("main-belt",240,1));
  for(const kind of POPULATION_KINDS) {
    let before=1;
    for(let distance=1;distance<=300;distance*=1.04) {
      const density=populationDensity(kind,distance,1);
      assert.ok(density<=before && density>=.02 && before-density<.08); before=density;
    }
  }
});

test("full-motion population opacity/density reveals and retreats smoothly without changing buffers", () => {
  const scene={primitives:new PrimitiveCollection()}, time=JulianDate.fromIso8601("2026-10-06T00:00:00Z");
  const layer=createProceduralPopulationLayer(scene,{getQuality:()=>"performance"});
  layer.update(time,{range:10*AU_METERS,solar:1,selectedId:"mars",elapsed:.032});
  const field=scene.primitives.get(0), material=field.appearance.material, geometry=field.geometryInstances.geometry;
  let before=material.uniforms.tint.w;
  assert.ok(before>0 && before<.08);
  for(let n=0;n<30;n++) {
    layer.update(time,{range:10*AU_METERS,solar:1,selectedId:"mars",elapsed:.032});
    const value=material.uniforms.tint.w;
    assert.ok(value>=before && value-before<.08); before=value;
    assert.equal(field.geometryInstances.geometry,geometry);
  }
  for(let n=0;n<30;n++) {
    layer.update(time,{range:.4*AU_METERS,solar:.1,selectedId:"mars",elapsed:.032});
    const value=material.uniforms.tint.w;
    assert.ok(value<=before && before-value<.08); before=value;
  }
  layer.destroy(); scene.primitives.destroy();
});

test("renderer owns four non-pickable primitives, stable buffers/matrices and idempotent quality/scene cleanup", () => {
  let quality="performance";
  const scene={primitives:new PrimitiveCollection(),camera:{positionWC:new Cartesian3(0,0,40*AU_METERS),frustum:{far:50*AU_METERS}}};
  const layer=createProceduralPopulationLayer(scene,{getQuality:()=>quality});
  const time=JulianDate.fromIso8601("2026-10-06T00:00:00Z");
  layer.update(time,{range:3e7,solar:0,selectedId:"earth",reduced:true}); assert.equal(scene.primitives.length,0);
  layer.update(time,{range:100*AU_METERS,solar:1,selectedId:"pluto",reduced:true}); assert.equal(scene.primitives.length,4);
  const first=scene.primitives.get(0), geometry=first.geometryInstances.geometry;
  assert.equal(first.allowPicking,false); assert.equal(geometry.primitiveType,0);
  const matrix=first.modelMatrix;
  for (let i=0;i<10;i++) layer.update(JulianDate.addSeconds(time,i*21600,new JulianDate()),{range:100*AU_METERS,solar:1,selectedId:"pluto",reduced:true});
  assert.equal(first.modelMatrix,matrix); assert.equal(first.geometryInstances.geometry,geometry);
  const origin=Matrix4.getTranslation(matrix,new Cartesian3());
  assert.ok(Cartesian3.distance(origin,bodyPositionFixed("sun",JulianDate.addSeconds(time,9*21600,new JulianDate())))<.01);
  const rotation=Matrix3.multiply(inertialToFixedMatrix(time),Matrix3.fromRotationX(23.43928*Math.PI/180),new Matrix3());
  assert.ok(Matrix3.toArray(rotation).every(Number.isFinite));
  const renderedTime=JulianDate.addSeconds(time,.016,new JulianDate());
  layer.render(renderedTime);
  assert.ok(Cartesian3.distance(Matrix4.getTranslation(matrix,new Cartesian3()),bodyPositionFixed("sun",renderedTime))<.01,"shared origin updates at exact render time between LOD updates");
  const materials=Array.from({length:4},(_,i)=>scene.primitives.get(i).appearance.material);
  quality="balanced"; layer.update(time,{range:100*AU_METERS,solar:1,selectedId:"earth",reduced:true});
  assert.equal(first.isDestroyed(),true); assert.equal(scene.primitives.length,4);
  assert.ok(materials.every(material=>material.isDestroyed()),"quality rebuild releases all material resources");
  layer.update(time,{range:3e7,solar:0,selectedId:"earth"});
  for(let i=0;i<4;i++) assert.equal(scene.primitives.get(i).show,false,"ordinary Earth handoff suppresses retained wide fields immediately");
  layer.update(time,{range:100*AU_METERS,solar:1,selectedId:"earth",reduced:true});
  layer.update(time,{range:3e7,solar:0,selectedId:"earth",live:false});
  for(let i=0;i<4;i++) assert.equal(scene.primitives.get(i).show,false);
  layer.destroy(); layer.destroy(); assert.equal(scene.primitives.length,0);
  for(let i=0;i<4;i++){const p=populationPrimitive(generatePopulation(POPULATION_KINDS[i],"performance")); assert.equal(p.allowPicking,false); p.appearance.material.destroy(); p.destroy();}
  scene.primitives.destroy();
});

test("deterministic background stars form a finite unit sphere with valid seam-safe cube projection", () => {
  const stars=generateStars(); assert.deepEqual(stars,generateStars()); assert.notDeepEqual(stars,generateStars("different"));
  for(let i=0;i<stars.length;i+=5) {
    assert.ok(Math.abs(Math.hypot(stars[i],stars[i+1],stars[i+2])-1)<1e-8);
    const [face,u,v]=starCubeProjection(stars[i],stars[i+1],stars[i+2]);
    assert.ok(face>=0 && face<6 && Math.abs(u)<=1 && Math.abs(v)<=1 && Number.isFinite(u+v));
  }
});

test("Trojan islands remain heliocentric at +/-60 degrees from current Jupiter through Earth rotation", () => {
  const scene={primitives:new PrimitiveCollection()};
  const layer=createProceduralPopulationLayer(scene,{getQuality:()=>"performance"});
  for (const iso of ["2026-10-06T00:00:00Z","2026-10-06T06:00:00Z","2027-10-06T00:00:00Z"]) {
    const time=JulianDate.fromIso8601(iso);
    layer.update(time,{range:10*AU_METERS,solar:1,selectedId:"jupiter",reduced:true});
    const field=Array.from({length:scene.primitives.length},(_,i)=>scene.primitives.get(i)).find(p=>p.orbitwatchPopulation.kind==="trojans");
    const inverse=Matrix3.transpose(Matrix3.multiply(inertialToFixedMatrix(time),Matrix3.fromRotationX(23.43928*Math.PI/180),new Matrix3()),new Matrix3());
    const sun=bodyPositionFixed("sun",time), relative=Cartesian3.subtract(bodyPositionFixed("jupiter",time),sun,new Cartesian3());
    const jupiter=Matrix3.multiplyByVector(inverse,relative,new Cartesian3()), longitude=Math.atan2(jupiter.y,jupiter.x);
    const positions=field.geometryInstances.geometry.attributes.position.values;
    let leading=0,trailing=0;
    for(let n=0;n<positions.length;n+=3) {
      const world=Matrix4.multiplyByPoint(field.modelMatrix,Cartesian3.fromArray(positions,n),new Cartesian3());
      const ecliptic=Matrix3.multiplyByVector(inverse,Cartesian3.subtract(world,sun,world),new Cartesian3());
      const angle=Math.atan2(Math.sin(Math.atan2(ecliptic.y,ecliptic.x)-longitude),Math.cos(Math.atan2(ecliptic.y,ecliptic.x)-longitude));
      assert.ok(Math.abs(Math.abs(angle)-Math.PI/3)<.55);
      assert.ok(Cartesian3.magnitude(ecliptic)>4*AU_METERS,"Sun-centered swarm, not a Jupiter-centered ring");
      if(angle>0) leading++; else trailing++;
    }
    assert.equal(leading,trailing);
  }
  layer.destroy(); scene.primitives.destroy();
});
