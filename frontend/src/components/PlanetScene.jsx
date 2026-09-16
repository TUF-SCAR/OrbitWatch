import {
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  BoundingSphere,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeadingPitchRange,
  ImageMaterialProperty,
  JulianDate,
  LabelStyle,
  Math as CesiumMath,
  Quaternion,
  Viewer,
} from "cesium";
import {
  BODY_MOONS,
  CELESTIAL_BODIES,
} from "../data/celestialBodies.js";
import "./PlanetScene.css";

const BASE_RADIUS = 4_000_000;
const TAU = Math.PI * 2;

function ringPoints(
  radius,
  steps = 144,
) {
  const points = [];

  for (
    let index = 0;
    index <= steps;
    index += 1
  ) {
    const angle =
      (index / steps) * TAU;

    points.push(
      new Cartesian3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        0,
      ),
    );
  }

  return points;
}

function bodyMaterial(body) {
  if (body?.texture) {
    return new ImageMaterialProperty({
      image: body.texture,
      transparent: false,
      repeat: new Cartesian2(1, 1),
    });
  }

  return Color.fromCssColorString(
    body?.color || "#8fa0aa",
  );
}

function spinOrientation(
  body,
  start,
) {
  return new CallbackProperty(
    (time, result) => {
      const seconds =
        JulianDate.secondsDifference(
          time,
          start,
        );

      const spinPeriod =
        body.type === "Star"
          ? 70
          : body.type === "Moon"
            ? 55
            : 42;

      return Quaternion.fromAxisAngle(
        Cartesian3.UNIT_Z,
        (seconds / spinPeriod) * TAU,
        result,
      );
    },
    false,
  );
}

export default function PlanetScene({
  bodyId,
  onReturnEarth,
  onOpenSystem,
}) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);

  const selectedBody =
    CELESTIAL_BODIES[bodyId] ||
    CELESTIAL_BODIES.mars;

  const centerBody =
    selectedBody.type === "Moon" &&
    selectedBody.parent
      ? CELESTIAL_BODIES[
          selectedBody.parent
        ] || selectedBody
      : selectedBody;

  const moons = useMemo(
    () =>
      (BODY_MOONS[
        centerBody.id
      ] || [])
        .map(
          (id) =>
            CELESTIAL_BODIES[id],
        )
        .filter(Boolean),
    [centerBody.id],
  );

  useEffect(() => {
    const host = mountRef.current;

    if (!host) return undefined;

    const viewer =
      new Viewer(host, {
        animation: false,
        timeline: false,
        baseLayer: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: true,
      });

    viewerRef.current = viewer;
    viewer.targetFrameRate = 45;
    viewer.resolutionScale =
      window.devicePixelRatio > 1.5
        ? 0.9
        : 1;

    viewer.scene.globe.show = false;
    viewer.scene.sun.show = false;
    viewer.scene.moon.show = false;

    if (
      viewer.scene.skyAtmosphere
    ) {
      viewer.scene.skyAtmosphere.show =
        false;
    }

    viewer.scene.backgroundColor =
      Color.fromCssColorString(
        "#01040a",
      );

    viewer.imageryLayers.removeAll();

    const controller =
      viewer.scene
        .screenSpaceCameraController;

    controller.enableInputs = true;
    controller.enableRotate = true;
    controller.enableZoom = true;
    controller.enableTilt = true;
    controller.enableLook = false;
    controller.enableTranslate = false;
    controller.inertiaSpin = 0.82;
    controller.inertiaZoom = 0.72;
    controller.minimumZoomDistance =
      BASE_RADIUS * 1.20;
    controller.maximumZoomDistance =
      BASE_RADIUS * 22;

    viewer.camera.lookAt(
      Cartesian3.ZERO,
      new HeadingPitchRange(
        CesiumMath.toRadians(25),
        CesiumMath.toRadians(-12),
        BASE_RADIUS * 5,
      ),
    );

    return () => {
      viewerRef.current = null;

      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
    };
  }, []);

  useEffect(() => {
    const viewer =
      viewerRef.current;

    if (
      !viewer ||
      viewer.isDestroyed()
    ) {
      return undefined;
    }

    viewer.entities.removeAll();

    const radius =
      BASE_RADIUS *
      (centerBody.visualScale || 1);

    const start = JulianDate.now();

    viewer.entities.add({
      id: `celestial-${centerBody.id}`,
      name: centerBody.name,
      position: Cartesian3.ZERO,
      orientation:
        spinOrientation(
          centerBody,
          start,
        ),
      ellipsoid: {
        radii: new Cartesian3(
          radius,
          radius,
          radius,
        ),
        material:
          bodyMaterial(centerBody),
        outline: false,
      },
    });

    for (
      const [index, ring]
      of (centerBody.rings || [])
        .entries()
    ) {
      viewer.entities.add({
        id:
          `ring-${centerBody.id}-${index}`,
        polyline: {
          positions: ringPoints(
            radius * ring.ratio,
          ),
          width:
            centerBody.id ===
            "saturn"
              ? 2.2
              : 1.25,
          material:
            Color.fromCssColorString(
              ring.color,
            ).withAlpha(
              ring.alpha,
            ),
        },
      });
    }

    moons.forEach(
      (moon, index) => {
        const orbitRadius =
          radius *
          (1.78 +
            index * 0.62);

        const isSelectedMoon =
          selectedBody.id === moon.id;

        viewer.entities.add({
          id:
            `moon-orbit-${moon.id}`,
          polyline: {
            positions: ringPoints(
              orbitRadius,
              110,
            ),
            width:
              isSelectedMoon
                ? 1.4
                : 0.7,
            material:
              Color.fromCssColorString(
                moon.color,
              ).withAlpha(
                isSelectedMoon
                  ? 0.38
                  : 0.11,
              ),
          },
        });

        const phase =
          index * 1.75 + 0.7;

        const moonPosition =
          new CallbackProperty(
            (time, result) => {
              const seconds =
                JulianDate
                  .secondsDifference(
                    time,
                    start,
                  );

              const angle =
                phase +
                seconds /
                  (18 +
                    index * 9);

              return Cartesian3
                .fromElements(
                  Math.cos(angle) *
                    orbitRadius,
                  Math.sin(angle) *
                    orbitRadius,
                  0,
                  result,
                );
            },
            false,
          );

        const moonRadius =
          radius *
          (
            isSelectedMoon
              ? 0.115
              : 0.082
          );

        viewer.entities.add({
          id: `moon-${moon.id}`,
          name: moon.name,
          position: moonPosition,
          orientation:
            spinOrientation(
              moon,
              start,
            ),
          ellipsoid: {
            radii:
              new Cartesian3(
                moonRadius,
                moonRadius,
                moonRadius,
              ),
            material:
              bodyMaterial(moon),
            outline: false,
          },
          label: {
            show:
              isSelectedMoon ||
              selectedBody.type !==
                "Moon",
            text:
              isSelectedMoon
                ? `${moon.name} // SELECTED`
                : moon.name,
            font:
              isSelectedMoon
                ? "700 15px Inter, system-ui, sans-serif"
                : "600 12px Inter, system-ui, sans-serif",
            fillColor:
              isSelectedMoon
                ? Color.WHITE
                : Color.WHITE.withAlpha(
                    0.66,
                  ),
            outlineColor:
              Color.BLACK.withAlpha(
                0.86,
              ),
            outlineWidth: 3,
            style:
              LabelStyle
                .FILL_AND_OUTLINE,
            pixelOffset:
              new Cartesian2(
                0,
                isSelectedMoon
                  ? -20
                  : -14,
              ),
            distanceDisplayCondition:
              new DistanceDisplayCondition(
                0,
                BASE_RADIUS * 18,
              ),
          },
        });
      },
    );

    const systemRadius =
      selectedBody.type === "Moon"
        ? radius *
          (
            2.4 +
            Math.max(
              0,
              moons.length - 1,
            ) * 0.62
          )
        : radius;

    viewer.camera
      .flyToBoundingSphere(
        new BoundingSphere(
          Cartesian3.ZERO,
          systemRadius,
        ),
        {
          duration: 0.85,
          offset:
            new HeadingPitchRange(
              CesiumMath.toRadians(
                28,
              ),
              CesiumMath.toRadians(
                -13,
              ),
              systemRadius *
                (
                  selectedBody.type ===
                  "Moon"
                    ? 2.7
                    : centerBody
                        .rings
                        ?.length
                      ? 5.0
                      : 4.2
                ),
            ),
        },
      );

    return undefined;
  }, [
    selectedBody,
    centerBody,
    moons,
  ]);

  const moonView =
    selectedBody.type === "Moon";

  return (
    <section className="planet-scene">
      <div
        ref={mountRef}
        className="planet-scene__cesium"
      />

      <div className="planet-scene__vignette" />

      <div className="planet-scene__readout">
        <span>
          {moonView
            ? "MOON VIEW"
            : "CELESTIAL VIEW"}
        </span>

        <strong>
          {selectedBody.name}
        </strong>

        <small>
          {selectedBody.type}
          {" // "}
          {Math.round(
            selectedBody.radiusKm,
          ).toLocaleString()}
          {" KM RADIUS"}

          {moonView
            ? ` // ORBITING ${centerBody.name.toUpperCase()}`
            : ""}
        </small>
      </div>

      <div className="planet-scene__actions">
        <button
          type="button"
          onClick={onReturnEarth}
        >
          RETURN EARTH
        </button>

        <button
          type="button"
          onClick={onOpenSystem}
        >
          SYSTEM NAV
        </button>
      </div>

      <div className="planet-scene__hint">
        DRAG TO ORBIT CAMERA
        <i />
        SCROLL TO ZOOM
      </div>
    </section>
  );
}
