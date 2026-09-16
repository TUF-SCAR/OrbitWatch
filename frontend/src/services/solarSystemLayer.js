import {
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  DistanceDisplayCondition,
  HeadingPitchRange,
  LabelStyle,
  JulianDate,
  NearFarScalar,
  Quaternion,
} from "cesium";
import {
  ALL_CELESTIAL_IDS,
  CELESTIAL_BODIES,
} from "../data/celestialBodies.js";
import {
  bodyPositionFixed,
  sampleBodyOrbitFixed,
} from "../data/solarSystemEphemeris.js";

const TAU = Math.PI * 2;
const EARTH_RADIUS_M = 6_371_008.8;
const POSITION_UPDATE_MS = 1000;

function colorOf(body) {
  return Color.fromCssColorString(
    body?.color || "#8fa0aa",
  );
}

function detailModelUrl(id) {
  return `/models/celestial/${id}.glb`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bodyOrientation(body, start) {
  return new CallbackProperty((time, result) => {
    const seconds = JulianDate.secondsDifference(time, start);

    const days =
      body.type === "Star" ? 25 :
      body.id === "jupiter" ? 0.414 :
      body.id === "saturn" ? 0.444 :
      body.id === "mars" ? 1.026 :
      body.id === "earth" ? 0.997 :
      1.1;

    return Quaternion.fromAxisAngle(
      Cartesian3.UNIT_Z,
      seconds / (days * 86400) * TAU,
      result,
    );
  }, false);
}

async function fullyFetch(url, signal) {
  const response = await fetch(url, {
    cache: "force-cache",
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}`,
    );
  }

  await response.arrayBuffer();
}

export function createSolarSystemLayer(
  viewer,
  options = {},
) {
  const placeholders = new Map();
  const detailEntities = new Map();

  let selectedId = "earth";
  let selectedOrbitEntity = null;
  let lastPositionUpdate = -Infinity;
  let destroyed = false;
  let focusToken = 0;
  let detailAbortController = null;
  let earthDetailActive = true;

  const start = JulianDate.clone(
    viewer.clock.currentTime,
  );

  const earthPlaceholder = viewer.entities.add({
    id: "celestial-placeholder-earth",
    name: "Earth",
    position: Cartesian3.ZERO,
    show: false,
    properties: { celestialId: "earth" },
    ellipsoid: {
      radii: new Cartesian3(
        EARTH_RADIUS_M,
        EARTH_RADIUS_M,
        EARTH_RADIUS_M,
      ),
      material: Color.fromCssColorString(
        "#315f91",
      ).withAlpha(0.78),
      outline: false,
      stackPartitions: 8,
      slicePartitions: 8,
      subdivisions: 16,
    },
    point: {
      pixelSize: 6,
      color: Color.fromCssColorString("#4d9ff5"),
      distanceDisplayCondition:
        new DistanceDisplayCondition(
          60_000_000,
          Number.MAX_VALUE,
        ),
    },
  });

  for (const id of ALL_CELESTIAL_IDS) {
    if (id === "earth") continue;

    const body = CELESTIAL_BODIES[id];
    const radiusM = Math.max(
      body.radiusKm * 1000,
      100,
    );

    const positionProperty =
      new ConstantPositionProperty(
        bodyPositionFixed(
          id,
          viewer.clock.currentTime,
          new Cartesian3(),
        ) || new Cartesian3(),
      );

    const planetLike =
      body.type === "Planet" ||
      body.type === "Star";

    const entity = viewer.entities.add({
      id: `celestial-placeholder-${id}`,
      name: body.name,
      position: positionProperty,
      properties: { celestialId: id },

      // Cheap far-away representation only.
      ellipsoid: {
        radii: new Cartesian3(
          radiusM,
          radiusM,
          radiusM,
        ),
        material: colorOf(body).withAlpha(
          body.type === "Star" ? 0.72 : 0.56,
        ),
        outline: false,
        stackPartitions: planetLike ? 8 : 5,
        slicePartitions: planetLike ? 8 : 5,
        subdivisions: planetLike ? 16 : 10,
      },

      point: {
        pixelSize:
          body.type === "Star" ? 9 :
          body.type === "Planet" ? 6 :
          4,
        color: colorOf(body),
        outlineColor: Color.BLACK.withAlpha(0.85),
        outlineWidth: 1,
        distanceDisplayCondition:
          new DistanceDisplayCondition(
            radiusM * (
              body.type === "Star" ? 22 :
              body.type === "Planet" ? 60 :
              90
            ),
            Number.MAX_VALUE,
          ),
        scaleByDistance:
          new NearFarScalar(
            1e8,
            1.1,
            1.4e13,
            0.7,
          ),
      },

      label: {
        show: false,
        text: body.name,
        font:
          "600 14px Inter, system-ui, sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset:
          new Cartesian2(0, -18),
      },
    });

    placeholders.set(id, {
      body,
      entity,
      positionProperty,
      radiusM,
    });
  }

  function removeSelectedOrbit() {
    if (
      selectedOrbitEntity &&
      !viewer.isDestroyed()
    ) {
      viewer.entities.remove(
        selectedOrbitEntity,
      );
    }

    selectedOrbitEntity = null;
  }

  function refreshSelectedOrbit() {
    if (
      !selectedId ||
      selectedId === "earth" ||
      viewer.isDestroyed()
    ) {
      removeSelectedOrbit();
      return;
    }

    const body =
      CELESTIAL_BODIES[selectedId];

    if (!body) {
      removeSelectedOrbit();
      return;
    }

    const positions =
      sampleBodyOrbitFixed(
        selectedId,
        viewer.clock.currentTime,
        body.type === "Moon" ? 72 : 96,
      );

    if (!positions.length) {
      removeSelectedOrbit();
      return;
    }

    if (!selectedOrbitEntity) {
      selectedOrbitEntity =
        viewer.entities.add({
          id: "celestial-selected-orbit",
          polyline: {
            positions,
            width:
              body.type === "Moon"
                ? 1.0
                : 1.2,
            material:
              colorOf(body).withAlpha(0.28),
          },
        });
    } else {
      selectedOrbitEntity
        .polyline.positions = positions;

      selectedOrbitEntity
        .polyline.material =
          colorOf(body).withAlpha(0.28);
    }
  }

  function updatePositions(force = false) {
    if (
      destroyed ||
      viewer.isDestroyed()
    ) {
      return;
    }

    const now = performance.now();

    if (
      !force &&
      now - lastPositionUpdate <
        POSITION_UPDATE_MS
    ) {
      return;
    }

    lastPositionUpdate = now;
    const time = viewer.clock.currentTime;

    for (
      const [id, item]
      of placeholders.entries()
    ) {
      const next =
        bodyPositionFixed(
          id,
          time,
          new Cartesian3(),
        );

      if (next) {
        item.positionProperty.setValue(next);
      }
    }

    // The orbit geometry is now ONLY for the selected object.
    refreshSelectedOrbit();
  }

  const removeClockTick =
    viewer.clock.onTick.addEventListener(
      () => updatePositions(false),
    );

  function setPlaceholderVisible(
    id,
    visible,
  ) {
    const item = placeholders.get(id);

    if (item?.entity) {
      item.entity.show = visible;
    }
  }

  function removeDetail(id) {
    const detail =
      detailEntities.get(id);

    if (
      detail &&
      !viewer.isDestroyed()
    ) {
      viewer.entities.remove(detail);
    }

    detailEntities.delete(id);
    setPlaceholderVisible(id, true);
  }

  function unloadDetailsExcept(
    wanted,
  ) {
    for (
      const id
      of Array.from(
        detailEntities.keys(),
      )
    ) {
      if (!wanted.has(id)) {
        removeDetail(id);
      }
    }
  }

  function setEarthDetail(active) {
    if (earthDetailActive === active) {
      return;
    }

    earthDetailActive = active;
    earthPlaceholder.show = !active;

    if (active) {
      options.showEarthDetail?.();
    } else {
      options.hideEarthDetail?.();
    }
  }

  async function loadDetails(
    ids,
    token,
  ) {
    const wanted =
      new Set(
        ids.filter(
          (id) =>
            id &&
            id !== "earth",
        ),
      );

    unloadDetailsExcept(wanted);

    detailAbortController?.abort();
    detailAbortController =
      new AbortController();

    const started = performance.now();

    await Promise.all(
      Array.from(wanted).map(
        async (id) => {
          if (
            destroyed ||
            token !== focusToken ||
            detailEntities.has(id)
          ) {
            return;
          }

          const item =
            placeholders.get(id);

          if (!item) return;

          const url = detailModelUrl(id);

          try {
            await fullyFetch(
              url,
              detailAbortController.signal,
            );
          } catch (error) {
            if (
              error?.name !== "AbortError"
            ) {
              console.warn(
                `OrbitWatch: detail model unavailable for ${id}; placeholder kept.`,
                error,
              );
            }

            return;
          }

          if (
            destroyed ||
            token !== focusToken ||
            viewer.isDestroyed()
          ) {
            return;
          }

          const detail =
            viewer.entities.add({
              id:
                `celestial-detail-${id}`,
              name:
                `${item.body.name} detail`,
              position:
                item.positionProperty,
              orientation:
                bodyOrientation(
                  item.body,
                  start,
                ),
              properties: {
                celestialId: id,
              },
              model: {
                uri: url,
                scale: item.radiusM,
                minimumPixelSize: 0,
                runAnimations: false,
                silhouetteColor:
                  colorOf(item.body)
                    .withAlpha(0.76),
                silhouetteSize:
                  id === selectedId
                    ? 1.2
                    : 0,
              },
            });

          detailEntities.set(
            id,
            detail,
          );

          // Avoid a blank frame while Cesium uploads the GLB to the GPU.
          window.setTimeout(
            () => {
              if (
                detailEntities.get(id) ===
                detail
              ) {
                setPlaceholderVisible(
                  id,
                  false,
                );
              }
            },
            250,
          );
        },
      ),
    );

    return performance.now() - started;
  }

  function setSelected(id) {
    selectedId = id || "earth";

    for (
      const [bodyId, item]
      of placeholders.entries()
    ) {
      if (item.entity.label) {
        item.entity.label.show =
          bodyId === selectedId;
      }

      const detail =
        detailEntities.get(bodyId);

      if (detail?.model) {
        detail.model.silhouetteSize =
          bodyId === selectedId
            ? 1.2
            : 0;
      }
    }

    refreshSelectedOrbit();
  }

  function flyToSingle(
    id,
    duration,
  ) {
    const item = placeholders.get(id);

    if (!item) return false;

    const position =
      item.positionProperty.getValue(
        viewer.clock.currentTime,
      );

    if (!position) return false;

    const body = item.body;

    const radius = Math.max(
      item.radiusM,
      body.type === "Asteroid"
        ? 8_000
        : 500_000,
    );

    viewer.camera.flyToBoundingSphere(
      new BoundingSphere(
        position,
        radius,
      ),
      {
        duration,
        offset:
          new HeadingPitchRange(
            0.34,
            -0.22,
            radius *
              (
                body.rings?.length
                  ? 7
                  : 4.7
              ),
          ),
      },
    );

    return true;
  }

  function flyToMoonSystem(
    moonId,
    duration,
  ) {
    const moon =
      CELESTIAL_BODIES[moonId];

    const moonItem =
      placeholders.get(moonId);

    if (
      !moon ||
      !moonItem ||
      moon.type !== "Moon"
    ) {
      return false;
    }

    const moonPosition =
      moonItem.positionProperty.getValue(
        viewer.clock.currentTime,
      );

    const parentPosition =
      moon.parent === "earth"
        ? Cartesian3.ZERO
        : placeholders
            .get(moon.parent)
            ?.positionProperty
            ?.getValue(
              viewer.clock.currentTime,
            );

    if (
      !moonPosition ||
      !parentPosition
    ) {
      return false;
    }

    const parent =
      CELESTIAL_BODIES[moon.parent];

    const midpoint =
      Cartesian3.midpoint(
        moonPosition,
        parentPosition,
        new Cartesian3(),
      );

    const separation =
      Cartesian3.distance(
        moonPosition,
        parentPosition,
      );

    const parentRadius =
      Math.max(
        (
          parent?.radiusKm ||
          1
        ) * 1000,
        1000,
      );

    const frameRadius =
      Math.max(
        separation * 0.60 +
          parentRadius,
        parentRadius * 2.2,
      );

    viewer.camera.flyToBoundingSphere(
      new BoundingSphere(
        midpoint,
        frameRadius,
      ),
      {
        duration,
        offset:
          new HeadingPitchRange(
            0.32,
            -0.22,
            frameRadius * 2.35,
          ),
      },
    );

    return true;
  }

  async function focus(id) {
    const bodyId = id || "earth";
    const token = ++focusToken;

    setSelected(bodyId);
    updatePositions(true);

    viewer.trackedEntity = undefined;
    viewer.camera.cancelFlight();

    if (bodyId === "earth") {
      detailAbortController?.abort();
      unloadDetailsExcept(new Set());
      setEarthDetail(true);

      return {
        handled: false,
        loadMs: 0,
      };
    }

    const body =
      CELESTIAL_BODIES[bodyId];

    if (!body) {
      return {
        handled: false,
        loadMs: 0,
      };
    }

    // Moon of Earth = keep real Earth loaded because we are still nearby.
    setEarthDetail(
      body.type === "Moon" &&
      body.parent === "earth",
    );

    const detailIds =
      body.type === "Moon"
        ? [
            bodyId,
            body.parent,
          ].filter(
            (value) =>
              value &&
              value !== "earth",
          )
        : [bodyId];

    // Keep the empty destination sphere while the real model loads.
    const loadMs =
      await loadDetails(
        detailIds,
        token,
      );

    if (
      destroyed ||
      token !== focusToken ||
      viewer.isDestroyed()
    ) {
      return {
        handled: true,
        cancelled: true,
        loadMs,
      };
    }

    // First visit: use measured load time for the final approach.
    // Cached visits are naturally much faster.
    const duration = clamp(
      loadMs / 1000,
      0.65,
      2.6,
    );

    const handled =
      body.type === "Moon"
        ? flyToMoonSystem(
            bodyId,
            duration,
          )
        : flyToSingle(
            bodyId,
            duration,
          );

    return {
      handled,
      loadMs,
      duration,
    };
  }

  function follow(id) {
    if (!id || id === "earth") {
      return false;
    }

    const entity =
      detailEntities.get(id) ||
      placeholders.get(id)?.entity;

    if (!entity) return false;

    viewer.trackedEntity = entity;
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    detailAbortController?.abort();
    removeClockTick?.();

    if (
      !viewer ||
      viewer.isDestroyed()
    ) {
      placeholders.clear();
      detailEntities.clear();
      return;
    }

    removeSelectedOrbit();

    for (
      const detail
      of detailEntities.values()
    ) {
      viewer.entities.remove(detail);
    }

    for (
      const item
      of placeholders.values()
    ) {
      viewer.entities.remove(
        item.entity,
      );
    }

    viewer.entities.remove(
      earthPlaceholder,
    );

    placeholders.clear();
    detailEntities.clear();
  }

  return {
    setSelected,
    focus,
    follow,
    updatePositions,
    destroy,
  };
}
