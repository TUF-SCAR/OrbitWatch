import {
  Cartesian3,
  JulianDate,
  Matrix3,
  Matrix4,
  Transforms,
} from "cesium";
import { CELESTIAL_BODIES } from "./celestialBodies.js";

export const AU_METERS = 149_597_870_700;
const J2000 = 2451545.0;
const OBLIQUITY = 23.43928 * Math.PI / 180;
const TAU = Math.PI * 2;

const PLANET_ELEMENTS = {
  mercury:{base:[.38709927,.20563593,7.00497902,252.25032350,77.45779628,48.33076593],rate:[.00000037,.00001906,-.00594749,149472.67411175,.16047689,-.12534081]},
  venus:{base:[.72333566,.00677672,3.39467605,181.97909950,131.60246718,76.67984255],rate:[.00000390,-.00004107,-.00078890,58517.81538729,.00268329,-.27769418]},
  earth:{base:[1.00000261,.01671123,-.00001531,100.46457166,102.93768193,0],rate:[.00000562,-.00004392,-.01294668,35999.37244981,.32327364,0]},
  mars:{base:[1.52371034,.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891],rate:[.00001847,.00007882,-.00813131,19140.30268499,.44441088,-.29257343]},
  jupiter:{base:[5.20288700,.04838624,1.30439695,34.39644051,14.72847983,100.47390909],rate:[-.00011607,-.00013253,-.00183714,3034.74612775,.21252668,.20469106]},
  saturn:{base:[9.53667594,.05386179,2.48599187,49.95424423,92.59887831,113.66242448],rate:[-.00125060,-.00050991,.00193609,1222.49362201,-.41897216,-.28867794]},
  uranus:{base:[19.18916464,.04725744,.77263783,313.23810451,170.95427630,74.01692503],rate:[-.00196176,-.00004397,-.00242939,428.48202785,.40805281,.04240589]},
  neptune:{base:[30.06992276,.00859048,1.77004347,-55.12002969,44.96476227,131.78422574],rate:[.00026291,.00005105,.00035372,218.45945325,-.32241464,-.00508664]},
};

const SMALL_BODY_ELEMENTS = {
  ceres:{a:2.7675,e:.0758,i:10.593,node:80.305,argPeri:73.598,M0:95.99},
  pluto:{a:39.482,e:.2488,i:17.140,node:110.299,argPeri:113.834,M0:14.53},
  eris:{a:67.78,e:.4407,i:44.04,node:35.95,argPeri:151.64,M0:204.0},
  haumea:{a:43.218,e:.191,i:28.19,node:121.9,argPeri:240.0,M0:205.0},
  makemake:{a:45.79,e:.159,i:28.98,node:79.62,argPeri:294.8,M0:166.0},
  vesta:{a:2.361,e:.0887,i:7.14,node:103.85,argPeri:151.2,M0:20.0},
  pallas:{a:2.772,e:.230,i:34.84,node:173.1,argPeri:310.2,M0:33.2},
  hygiea:{a:3.142,e:.112,i:3.84,node:283.2,argPeri:312.3,M0:215.0},
  eros:{a:1.458,e:.223,i:10.83,node:304.4,argPeri:178.8,M0:320.0},
  bennu:{a:1.1264,e:.2037,i:6.034,node:2.06,argPeri:66.22,M0:101.7},
  apophis:{a:.9224,e:.191,i:3.34,node:203.96,argPeri:126.6,M0:196.0},
  psyche:{a:2.923,e:.134,i:3.10,node:150.3,argPeri:229.6,M0:283.0},
};

const MOON_ELEMENTS = {
  moon:{aKm:384400,e:.0554,argPeri:318.15,M0:135.27,i:5.16,node:125.08,periodDays:27.322},
  phobos:{aKm:9375,e:.015,argPeri:216.3,M0:189.7,i:1.1,node:169.2,periodDays:.3187},
  deimos:{aKm:23457,e:0,argPeri:0,M0:205.0,i:1.8,node:54.3,periodDays:1.2625},
  io:{aKm:421800,e:.004,argPeri:49.1,M0:330.9,i:0,node:0,periodDays:1.762732},
  europa:{aKm:671100,e:.009,argPeri:45.0,M0:345.4,i:.5,node:184.0,periodDays:3.525463},
  ganymede:{aKm:1070400,e:.001,argPeri:198.3,M0:324.8,i:.2,node:58.5,periodDays:7.155588},
  callisto:{aKm:1882700,e:.007,argPeri:43.8,M0:87.4,i:.3,node:309.1,periodDays:16.690440},
  mimas:{aKm:186000,e:.020,argPeri:160.4,M0:275.3,i:1.6,node:66.2,periodDays:.942422},
  enceladus:{aKm:238400,e:.005,argPeri:119.5,M0:57.0,i:0,node:0,periodDays:1.370218},
  tethys:{aKm:295000,e:.001,argPeri:335.3,M0:0,i:1.1,node:273.0,periodDays:1.887802},
  dione:{aKm:377700,e:.002,argPeri:116.0,M0:212.0,i:0,node:0,periodDays:2.736916},
  rhea:{aKm:527200,e:.001,argPeri:44.3,M0:31.5,i:.3,node:133.7,periodDays:4.517503},
  titan:{aKm:1221900,e:.029,argPeri:78.3,M0:11.7,i:.3,node:78.6,periodDays:15.945448},
  iapetus:{aKm:3561700,e:.028,argPeri:254.5,M0:74.8,i:7.6,node:86.5,periodDays:79.331002},
  miranda:{aKm:129846,e:.001,argPeri:154.8,M0:73.0,i:4.4,node:100.9,periodDays:1.413479},
  ariel:{aKm:190929,e:.001,argPeri:9.6,M0:193.5,i:0,node:0,periodDays:2.520379},
  umbriel:{aKm:265986,e:.004,argPeri:183.4,M0:253.0,i:.1,node:174.8,periodDays:4.144177},
  titania:{aKm:436298,e:.002,argPeri:184.0,M0:68.1,i:.1,node:29.5,periodDays:8.705869},
  oberon:{aKm:583511,e:.002,argPeri:132.2,M0:143.6,i:.1,node:76.8,periodDays:13.463237},
  proteus:{aKm:117600,e:0,argPeri:0,M0:276.8,i:0,node:0,periodDays:1.122315},
  triton:{aKm:354800,e:0,argPeri:0,M0:63.0,i:157.3,node:178.1,periodDays:5.876994},
  charon:{aKm:19571,e:.0002,argPeri:0,M0:95,i:.08,node:85,periodDays:6.38723},
  styx:{aKm:42656,e:.006,argPeri:0,M0:160,i:.8,node:0,periodDays:20.16155},
  nix:{aKm:48694,e:.002,argPeri:0,M0:220,i:.1,node:0,periodDays:24.85463},
  kerberos:{aKm:57783,e:.004,argPeri:0,M0:285,i:.4,node:0,periodDays:32.16756},
  hydra:{aKm:64738,e:.005,argPeri:0,M0:340,i:.3,node:0,periodDays:38.20177},
};

// Expose the same reference elements used by the scene to the inspector.
// Moon/small-body values are simplified catalog models, not fitted ephemerides.
export function bodyOrbitalReference(id) {
  const moon = MOON_ELEMENTS[id];
  if (moon) return { semimajorKm: moon.aKm, eccentricity: moon.e, inclination: moon.i, periodDays: moon.periodDays };
  const planet = PLANET_ELEMENTS[id];
  const small = SMALL_BODY_ELEMENTS[id];
  if (!planet && !small) return null;
  const [a, e, i] = planet ? planet.base : [small.a, small.e, small.i];
  return { semimajorKm: a * AU_METERS / 1000, semimajorAu: a, eccentricity: e, inclination: i, periodDays: planet ? 360 * 36525 / planet.rate[3] : 365.2568983 * a ** 1.5 };
}

function jd(time) {
  return JulianDate.toDate(time).getTime() / 86400000 + 2440587.5;
}

function rad(degrees) {
  return degrees * Math.PI / 180;
}

function wrap(value) {
  const result = value % TAU;
  return result < 0 ? result + TAU : result;
}

function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i += 1) {
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }
  return E;
}

function orbitalVector({ a, e, i, node, argPeri, M, scale = AU_METERS }) {
  const E = solveKepler(wrap(rad(M)), e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const w = rad(argPeri);
  const O = rad(node);
  const I = rad(i);
  const cw = Math.cos(w), sw = Math.sin(w);
  const cO = Math.cos(O), sO = Math.sin(O);
  const ci = Math.cos(I), si = Math.sin(I);

  return new Cartesian3(
    scale * ((cw*cO - sw*sO*ci)*xp + (-sw*cO - cw*sO*ci)*yp),
    scale * ((cw*sO + sw*cO*ci)*xp + (-sw*sO + cw*cO*ci)*yp),
    scale * (sw*si*xp + cw*si*yp),
  );
}

function planetHeliocentric(id, time) {
  const spec = PLANET_ELEMENTS[id];
  if (!spec) return null;

  const T = (jd(time) - J2000) / 36525;
  const values = spec.base.map((value, index) => value + spec.rate[index] * T);
  const [a, e, i, L, longPeri, node] = values;

  return orbitalVector({
    a, e, i, node,
    argPeri: longPeri - node,
    M: L - longPeri,
  });
}

function smallBodyHeliocentric(id, time) {
  const spec = SMALL_BODY_ELEMENTS[id];
  if (!spec) return null;
  const periodDays = 365.2568983 * Math.pow(spec.a, 1.5);
  const M = spec.M0 + 360 * (jd(time) - J2000) / periodDays;
  return orbitalVector({ ...spec, M });
}

function heliocentric(id, time) {
  if (id === "sun") return Cartesian3.ZERO;
  return PLANET_ELEMENTS[id]
    ? planetHeliocentric(id, time)
    : smallBodyHeliocentric(id, time);
}

function moonLocal(id, time) {
  const spec = MOON_ELEMENTS[id];
  if (!spec) return null;

  const M = spec.M0 + 360 * (jd(time) - J2000) / spec.periodDays;

  return orbitalVector({
    a: spec.aKm,
    e: spec.e,
    i: spec.i,
    node: spec.node,
    argPeri: spec.argPeri,
    M,
    scale: 1000,
  });
}

function geocentricEcliptic(id, time) {
  if (id === "earth") return Cartesian3.ZERO;

  const earth = planetHeliocentric("earth", time);
  const body = CELESTIAL_BODIES[id];
  if (!body) return null;

  if (body.type === "Moon") {
    const parentHelio = body.parent === "earth"
      ? earth
      : heliocentric(body.parent, time);

    const local = moonLocal(id, time);
    if (!parentHelio || !local) return null;

    return Cartesian3.subtract(
      Cartesian3.add(parentHelio, local, new Cartesian3()),
      earth,
      new Cartesian3(),
    );
  }

  const target = heliocentric(id, time);
  if (!target) return null;

  return Cartesian3.subtract(target, earth, new Cartesian3());
}

function eclipticToEquatorial(vector, result = new Cartesian3()) {
  const c = Math.cos(OBLIQUITY);
  const s = Math.sin(OBLIQUITY);
  result.x = vector.x;
  result.y = c * vector.y - s * vector.z;
  result.z = s * vector.y + c * vector.z;
  return result;
}

export function bodyPositionInertial(id, time, result = new Cartesian3()) {
  const ecliptic = geocentricEcliptic(id, time);
  if (!ecliptic) return undefined;
  return eclipticToEquatorial(ecliptic, result);
}

// Positions, orbit lines and local camera must use the same conversion,
// including the existing inertial fallback while Cesium's ICRF data loads.
export function inertialToFixedMatrix(time, result = new Matrix3()) {
  return Transforms.computeIcrfToFixedMatrix(time, result) || Matrix3.clone(Matrix3.IDENTITY, result);
}

export function bodyPositionFixed(id, time, result = new Cartesian3()) {
  const inertial = bodyPositionInertial(id, time);
  if (!inertial) return undefined;
  return Matrix3.multiplyByVector(inertialToFixedMatrix(time), inertial, result);
}

// A body-centred inertial frame expressed in Cesium's Earth-fixed world.
// basis is constant in inertial space. R(time) * basis cancels Earth's
// rotation in the local view without freezing any body's orbital motion.
export function bodyLocalTransform(id, time, basis, result = new Matrix4()) {
  const rotation = Matrix3.multiply(inertialToFixedMatrix(time), basis, new Matrix3());
  return Matrix4.fromRotationTranslation(rotation, bodyPositionFixed(id, time), result);
}

function vectorAtMeanAnomaly(id, meanAnomaly, time) {
  if (PLANET_ELEMENTS[id]) {
    const spec = PLANET_ELEMENTS[id];
    const T = (jd(time) - J2000) / 36525;
    const values = spec.base.map((value, index) => value + spec.rate[index] * T);
    const [a, e, i, , longPeri, node] = values;
    return orbitalVector({
      a, e, i, node,
      argPeri: longPeri - node,
      M: meanAnomaly,
    });
  }

  if (SMALL_BODY_ELEMENTS[id]) {
    return orbitalVector({ ...SMALL_BODY_ELEMENTS[id], M: meanAnomaly });
  }

  if (MOON_ELEMENTS[id]) {
    const moon = MOON_ELEMENTS[id];
    return orbitalVector({
      a: moon.aKm,
      e: moon.e,
      i: moon.i,
      node: moon.node,
      argPeri: moon.argPeri,
      M: meanAnomaly,
      scale: 1000,
    });
  }

  return null;
}

export function sampleBodyOrbitFixed(id, time, steps = 128) {
  const body = CELESTIAL_BODIES[id];
  if (!body) return [];

  const earth = planetHeliocentric("earth", time);
  const matrix = inertialToFixedMatrix(time);

  const parentHelio = body.type === "Moon"
    ? (body.parent === "earth" ? earth : heliocentric(body.parent, time))
    : null;

  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const M = index / steps * 360;
    let ecliptic;

    if (body.type === "Moon") {
      const local = vectorAtMeanAnomaly(id, M, time);
      if (!local || !parentHelio) continue;

      ecliptic = Cartesian3.subtract(
        Cartesian3.add(parentHelio, local, new Cartesian3()),
        earth,
        new Cartesian3(),
      );
    } else {
      const helio = vectorAtMeanAnomaly(id, M, time);
      if (!helio) continue;
      ecliptic = Cartesian3.subtract(helio, earth, new Cartesian3());
    }

    const inertial = eclipticToEquatorial(ecliptic, new Cartesian3());
    points.push(
      Matrix3.multiplyByVector(matrix, inertial, new Cartesian3()),
    );
  }

  return points;
}
