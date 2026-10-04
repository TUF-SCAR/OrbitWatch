import { Color, DistanceDisplayCondition, VelocityOrientationProperty } from "cesium";
import { getSatelliteModelUrl } from "../data/satelliteModels.js";

// Own one optional model entity. A trajectory refresh replaces its position
// property, not the entity/ModelGraphics, so Cesium can retain the loaded GLB.
export function createSelectedSatelliteDetail(viewer, categoryColors) {
  let detail = null;
  let selectedId = null;
  function clear() {
    if (detail && !viewer.isDestroyed()) viewer.entities.remove(detail);
    detail = null;
    selectedId = null;
  }
  return {
    clear,
    update(object, base, active) {
      const url = getSatelliteModelUrl(object);
      if (!active || !base || !url || viewer.isDestroyed()) { clear(); return null; }
      if (selectedId !== object.noradId) clear();
      if (!detail) {
        detail = viewer.entities.add({
          name: `${object.name || object.noradId} detail model`,
          properties: { noradId: object.noradId },
          model: {
            uri: url,
            minimumPixelSize: 34,
            maximumScale: 4200,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 4_800_000),
            silhouetteColor: (categoryColors[object.category] || Color.WHITE).withAlpha(0.82),
            silhouetteSize: 1.1,
            runAnimations: false,
          },
        });
        selectedId = object.noradId;
      }
      if (detail.position !== base.position) {
        detail.position = base.position;
        detail.orientation = new VelocityOrientationProperty(base.position);
      }
      return detail;
    },
  };
}
