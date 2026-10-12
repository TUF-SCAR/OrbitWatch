import assert from "node:assert/strict";
import test from "node:test";
import { Cartesian3, JulianDate, Matrix3, Matrix4, PrimitiveCollection } from "cesium";
import { CELESTIAL_BODIES } from "../src/data/celestialBodies.js";
import { PLANETARY_RINGS, generatePlanetaryRings } from "../src/data/planetaryRings.js";
import { bodyPositionFixed, inertialToFixedMatrix } from "../src/data/solarSystemEphemeris.js";
import { createPlanetaryRingLayer, ringVisibility } from "../src/services/planetaryRingLayer.js";

test("only four giant planets own finite deterministic bounded ring buffers, preserving sourced bands/gaps", () => {
  assert.deepEqual(Object.keys(PLANETARY_RINGS),["jupiter","saturn","uranus","neptune"]);
  assert.throws(()=>generatePlanetaryRings("haumea"));
  for (const id of Object.keys(PLANETARY_RINGS)) {
    let previous=0;
    for (const profile of ["performance","balanced","quality"]) {
      const data=generatePlanetaryRings(id,profile);
      assert.deepEqual(data,generatePlanetaryRings(id,profile));
      assert.ok(data.vertices>previous && data.vertices<16000); previous=data.vertices;
      assert.ok([...data.positions,...data.colors,...data.limits].every(Number.isFinite));
      assert.ok([...data.indices].every(index=>index<data.vertices));
      assert.equal(data.indices.length%3,0);
      const radius=CELESTIAL_BODIES[id].radiusKm;
      const lower=Math.min(...PLANETARY_RINGS[id].bands.map(b=>b.inner/radius));
      const upper=Math.max(...PLANETARY_RINGS[id].bands.map(b=>b.outer/radius));
      for (let n=0;n<data.positions.length;n+=3) {
        const r=Math.hypot(data.positions[n],data.positions[n+1]);
        assert.ok(r>=lower-.041 && r<=upper+.041);
        assert.equal(data.positions[n+2],0);
      }
    }
  }
  const bands=PLANETARY_RINGS.saturn.bands;
  assert.equal(bands[1].outer,117507); assert.equal(bands[2].inner,122340,"Cassini division remains empty");
  assert.ok(PLANETARY_RINGS.jupiter.bands.every(b=>b.opacity<=.15),"Jupiter stays at least 85% transparent");
  assert.ok(PLANETARY_RINGS.jupiter.bands.filter(b=>b.outer>129100 || b.inner<122400).every(b=>b.opacity<.01),"extended dust is nearly invisible; narrow main ring carries the subtle detail");
  assert.ok(PLANETARY_RINGS.saturn.bands.some(b=>b.opacity>.8),"Saturn retains the rich dominant rings");
});

test("ring visibility is continuous and bounded through close, medium and symbolic scales in both directions", () => {
  for (const id of Object.keys(PLANETARY_RINGS)) {
    const radius=CELESTIAL_BODIES[id].radiusKm*1000;
    let before=1;
    for(let r=1.08;r<100;r+=.05) {
      const value=ringVisibility(r*radius,radius);
      assert.ok(value>=0 && value<=before && before-value<.004); before=value;
    }
    assert.equal(ringVisibility(7*radius,radius),1);
    assert.equal(ringVisibility(100*radius,radius),0);
  }
});

test("rings share canonical model poses across Earth rotation, preserve buffers and release ownership/quality/mask resources", () => {
  let quality="balanced";
  const scene={ primitives:new PrimitiveCollection(), canvas:{clientHeight:720}, camera:{positionWC:new Cartesian3(),frustum:{fovy:Math.PI/3}} };
  const pose=new Matrix4(), time=JulianDate.fromIso8601("2026-10-06T00:00:00Z");
  const getPose=(id,t)=>Matrix4.fromRotationTranslation(inertialToFixedMatrix(t),bodyPositionFixed(id,t),pose);
  const layer=createPlanetaryRingLayer(scene,{getQuality:()=>quality,getPose});
  const mask=layer.modelMask(); assert.equal(mask,layer.modelMask());
  for (const id of ["saturn","uranus","neptune","jupiter"]) {
    const radius=CELESTIAL_BODIES[id].radiusKm*1000;
    scene.camera.positionWC=Cartesian3.add(bodyPositionFixed(id,time),new Cartesian3(0,0,7*radius),new Cartesian3());
    layer.update(time,{owners:new Map([[id,1]]),reduced:true});
    assert.equal(scene.primitives.length,1);
    const field=scene.primitives.get(0);
    assert.equal(field.show,true); assert.equal(field.allowPicking,false);
    quality=quality==="balanced" ? "quality" : "balanced";
    layer.update(time,{owners:new Map([[id,1]]),elapsed:.032});
    assert.equal(scene.primitives.get(0).appearance.material.uniforms.alpha,1,"profile change must not make a steady ring disappear and re-fade");
    // Continue matrix/buffer checks on this fresh, fully visible quality field.
    const active=scene.primitives.get(0), activeGeometry=active.geometryInstances.geometry, activeMatrix=active.modelMatrix;
    for(let n=0;n<10;n++) {
      const t=JulianDate.addSeconds(time,n*2160,new JulianDate());
      layer.render(t);
      assert.equal(active.modelMatrix,activeMatrix); assert.equal(active.geometryInstances.geometry,activeGeometry);
      assert.ok(Cartesian3.distance(Matrix4.getTranslation(activeMatrix,new Cartesian3()),bodyPositionFixed(id,t))<.01);
      const local=Matrix4.multiply(Matrix4.inverseTransformation(getPose(id,t),new Matrix4()),activeMatrix,new Matrix4());
      assert.ok(Matrix3.equalsEpsilon(Matrix4.getMatrix3(local,new Matrix3()),Matrix3.fromScale(new Cartesian3(radius,radius,radius)),.01));
    }
    assert.equal(field.isDestroyed(),true);
    let alpha=active.appearance.material.uniforms.alpha;
    scene.camera.positionWC=Cartesian3.add(bodyPositionFixed(id,time),new Cartesian3(0,0,100*radius),new Cartesian3());
    for(let n=0;n<20;n++) {
      layer.update(time,{owners:new Map([[id,1]]),elapsed:.016});
      const next=active.appearance.material.uniforms.alpha;
      assert.ok(next<=alpha && alpha-next<.13); alpha=next;
    }
    const material=active.appearance.material;
    quality=quality==="balanced" ? "quality" : "balanced";
    layer.update(time,{owners:new Map([[id,1]]),reduced:true});
    assert.equal(active.isDestroyed(),true); assert.equal(material.isDestroyed(),true);
    assert.equal(scene.primitives.length,1);
    layer.update(time,{owners:new Map(),reduced:true}); assert.equal(scene.primitives.length,0);
  }
  layer.destroy(); layer.destroy(); assert.equal(mask.isDestroyed(),true); scene.primitives.destroy();
});
