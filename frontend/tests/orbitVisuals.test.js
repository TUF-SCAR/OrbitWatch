import assert from "node:assert/strict";
import test from "node:test";
import { Color, Entity, JulianDate } from "cesium";
import { satelliteOrbitStyle, solarOrbitStyle, styleSatelliteOrbit } from "../src/services/orbitVisuals.js";

test("satellite styling keeps color/path/material identity with selected dominance and bounded clutter", () => {
  const positions = [{ x: 1, y: 2, z: 3 }];
  const data = { orbitEntity: new Entity({ polyline: { positions, width: 3, material: Color.CYAN } }) };
  const path = data.orbitEntity.polyline.positions;
  styleSatelliteOrbit(data, Color.CYAN, false, 6, 27000000);
  const material = data.orbitEntity.polyline.material;
  for (const count of [1, 6, 24, 143]) for (const height of [100000, 27000000, 60000000, 100000000]) {
    const normal = satelliteOrbitStyle(false, count, height), selected = satelliteOrbitStyle(true, count, height);
    assert.ok(selected.width > normal.width && selected.alpha >= normal.alpha);
    assert.ok(normal.width <= .8 && selected.width <= 1.5, "padded raster quad retains a thin visible core");
    assert.ok(normal.alpha >= 0 && normal.alpha <= .28);
    assert.ok(normal.base * count <= 25,"dense thread budget remains bounded within the catalog");
    assert.equal(normal.alpha,normal.base,"context is a complete, steady thread");
    styleSatelliteOrbit(data, Color.CYAN, true, count, height);
    assert.equal(data.orbitEntity.polyline.material, material);
    assert.equal(data.orbitEntity.polyline.positions, path);
    const color = material.getValue(JulianDate.now()).color;
    assert.equal(color.red, Color.CYAN.red); assert.equal(color.blue, Color.CYAN.blue);
  }
  assert.ok(satelliteOrbitStyle(false, 143).alpha < satelliteOrbitStyle(false, 6).alpha);
  assert.equal(satelliteOrbitStyle(true, 6, 1e11).alpha, 0);
});

test("solar orbit hierarchy stays restrained and returns local paths on zoom-in", () => {
  for (const selected of [false,true]) for (const overview of [0,.5,1]) {
    const style = solarOrbitStyle({moon:false,selected,solar:1,overview});
    assert.ok(style.alpha <= .24 && style.width * .45 <= 1.3);
  }
  assert.equal(solarOrbitStyle({moon:false,selected:true,solar:0,overview:0}).alpha,0);
  assert.equal(solarOrbitStyle({moon:true,selected:true,solar:1,local:1}).alpha,0);
  assert.equal(solarOrbitStyle({moon:true,selected:true,solar:0,local:1}).alpha,.2);
});
