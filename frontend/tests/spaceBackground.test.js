import assert from "node:assert/strict";
import test from "node:test";
import { createSpaceBackgroundForTest } from "./spaceBackgroundFixture.js";
import { galacticDensity, starCubeDirection, starCubeProjection } from "../src/services/spaceBackground.js";

test("galactic density stays dark, smooth and seamless across cube faces", () => {
  for(let face=0;face<6;face++) for(let u=-1;u<=1;u+=.05) for(let v=-1;v<=1;v+=.05) {
    const direction=starCubeDirection(face,u,v), density=galacticDensity(...direction);
    assert.ok(Number.isFinite(density) && density>=0 && density<1.2);
    const [projected,x,y]=starCubeProjection(...direction);
    const roundtrip=starCubeDirection(projected,x,y);
    assert.ok(direction.every((value,index)=>Math.abs(value-roundtrip[index])<1e-10));
    const near=starCubeDirection(face,u+.001,v);
    assert.ok(Math.abs(density-galacticDensity(...near))<.01);
  }
});

test("background uses six bounded quality canvases, deterministic star count and public SkyBox cleanup", () => {
  createSpaceBackgroundForTest((create,canvases)=>{
    for (const [quality,size] of [["performance",256],["balanced",512],["quality",1024]]) {
      const sky=create(quality);
      assert.deepEqual(sky.orbitwatchBackground,{profile:quality,faceSize:size,stars:9000});
      assert.equal(Object.keys(sky.sources).length,6);
      for(const face of Object.values(sky.sources)) assert.equal(face.width,size);
      sky.destroy(); assert.equal(sky.isDestroyed(),true);
    }
    assert.ok(canvases.every(canvas=>canvas.width<=1024 && canvas.height<=1024));
  });
});
