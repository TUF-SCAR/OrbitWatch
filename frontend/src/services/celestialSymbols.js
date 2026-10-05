import { Cartesian2, Cartesian3, Color, HorizontalOrigin, LabelCollection, LabelStyle, Matrix4, PointPrimitiveCollection, VerticalOrigin } from "cesium";

// GPU RTE's fixed 65536 split loses high-bit precision at multi-AU world
// coordinates. Subtract the camera in CPU doubles first, then send the exact
// relative center to both collections. This is a render origin, not a change
// to the ephemeris, camera frame or picking identity.
export function relativeCelestialCenter(center, eye, result = new Cartesian3()) {
  return Cartesian3.subtract(center, eye, result);
}

export function createCelestialSymbols(scene, positionOf) {
  const points = scene.primitives.add(new PointPrimitiveCollection());
  const labels = scene.primitives.add(new LabelCollection());
  const items = new Map();
  return {
    add(entity, body) {
      const point = points.add({ id: entity, position: Cartesian3.ZERO, show: false, pixelSize: 6, color: Color.fromCssColorString(body.color), outlineColor: Color.BLACK, outlineWidth: 1 });
      const label = labels.add({ id: entity, position: Cartesian3.ZERO, show: false, text: body.name, font: "600 14px Inter, sans-serif", horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.CENTER, style: LabelStyle.FILL_AND_OUTLINE, fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, pixelOffset: new Cartesian2(0, -19) });
      const item = { point, label, relative: new Cartesian3() };
      items.set(body.id, item);
      return item;
    },
    update(time) {
      const eye = scene.camera?.positionWC;
      if (!eye) return;
      Matrix4.fromTranslation(eye, points.modelMatrix);
      Matrix4.clone(points.modelMatrix, labels.modelMatrix);
      for (const [id, item] of items) {
        relativeCelestialCenter(positionOf(id, time), eye, item.relative);
        item.point.position = item.relative;
        item.label.position = item.relative;
      }
    },
    destroy() { scene.primitives.remove(points); scene.primitives.remove(labels); items.clear(); },
  };
}
