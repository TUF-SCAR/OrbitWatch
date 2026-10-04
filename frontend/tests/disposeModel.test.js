import { test } from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { disposeModel } from "../src/utils/disposeModel.js";

test("preview disposal releases shared GPU resources and closes each decoded image once", () => {
  let closed = 0;
  const bitmap = { close() { closed += 1; } };
  const color = new Texture(bitmap), normal = new Texture(bitmap);
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial({ map: color, normalMap: normal });
  const root = new Group();
  root.add(new Mesh(geometry, material), new Mesh(geometry, [material]));
  const disposed = new Map();
  for (const resource of [color, normal, geometry, material]) resource.addEventListener("dispose", () => disposed.set(resource, (disposed.get(resource) || 0) + 1));
  disposeModel(root);
  assert.equal(closed, 1, "shared ImageBitmap must close once, independently of texture disposal");
  assert.deepEqual([...disposed.values()], [1, 1, 1, 1]);
});
