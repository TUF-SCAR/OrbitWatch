import { Cartesian2, Cartesian3, Color, EllipsoidalOccluder, HorizontalOrigin, LabelCollection, LabelStyle, SceneMode, SceneTransforms, VerticalOrigin } from "cesium";
import { OVERVIEW_LABELS, labelAltitudeRange, selectLabelBoxes } from "./placeLabelLayout.js";

const NATIVE_LABEL_MAPS = new Set(["bing-labels", "bing-road", "osm", "carto-dark", "carto-voyager"]);

export function createPlaceLabelLayer(viewer) {
  const scene = viewer.scene;
  const collection = scene.primitives.add(new LabelCollection({ scene }));
  const occluder = new EllipsoidalOccluder(scene.globe.ellipsoid);
  const screen = new Cartesian2();
  const measure = document.createElement("canvas").getContext("2d");
  const entries = OVERVIEW_LABELS.map(([name, lon, lat, kind, rank]) => {
    const font = `${kind === "country" ? "600 14" : "500 13"}px Inter, system-ui, sans-serif`;
    measure.font = font;
    const position = Cartesian3.fromDegrees(lon, lat, 4500);
    const label = collection.add({ position, text: name, font, show: false,
      horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.CENTER,
      fillColor: kind === "country" ? Color.fromCssColorString("#cde4e9") : Color.WHITE,
      outlineColor: Color.BLACK.withAlpha(0.9), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE });
    return { label, position, width: measure.measureText(name).width, range: labelAltitudeRange(kind, rank) };
  });
  let lastLayout = -Infinity;
  return {
    update(now, enabled, activeMap) {
      collection.show = enabled && !NATIVE_LABEL_MAPS.has(activeMap);
      if (!collection.show || now - lastLayout < 200) return;
      lastLayout = now;
      const altitude = viewer.camera.positionCartographic.height;
      const flat = scene.mode !== SceneMode.SCENE3D;
      occluder.cameraPosition = viewer.camera.positionWC;
      const candidates = [];
      for (const entry of entries) {
        if (altitude < entry.range[0] || altitude > entry.range[1]) continue;
        if (!flat && !occluder.isPointVisible(entry.position)) continue;
        const point = SceneTransforms.worldToWindowCoordinates(scene, entry.position, screen);
        if (point) candidates.push({ ...entry, x: point.x, y: point.y });
      }
      const visible = new Set(selectLabelBoxes(candidates, scene.canvas.clientWidth, scene.canvas.clientHeight).map((entry) => entry.label));
      // Avoid dirtying the glyph buffers twice on every layout when a label
      // remains visible. Cesium ignores assignments that retain the same value.
      for (const entry of entries) entry.label.show = visible.has(entry.label);
    },
    destroy() { scene.primitives.remove(collection); },
  };
}
