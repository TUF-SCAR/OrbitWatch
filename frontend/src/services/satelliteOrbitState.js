import { CallbackPositionProperty, Cartesian3, HermitePolynomialApproximation, JulianDate, Matrix3, Matrix4, SampledPositionProperty, Transforms } from "cesium";

// Backend geographic samples are already WGS84 Earth-fixed. Recover a stable
// TEME-like frame at EACH sample time, then apply only the scene-time rotation.
// Cesium's public TEME/pseudo-fixed transform uses UTC as UT1 (no EOP download
// or asynchronous ICRF/fallback switch). This is a visualization approximation,
// not a replacement propagator; all radii and positions still come from SGP4.
const rotation = new Matrix3(), inverse = new Matrix3();
const ut1Time = new JulianDate();
export function satelliteFrame(time, result = new Matrix4(), dut1 = 0) {
  // Cesium evaluates GMST using UTC; shifting by supplied UT1-UTC evaluates it
  // at UT1. No downloaded EOP or asynchronous ICRF switch is introduced.
  const earthTime = dut1 ? JulianDate.addSeconds(time,dut1,ut1Time) : time;
  return Matrix4.fromRotationTranslation(Transforms.computeTemeToPseudoFixedMatrix(earthTime, rotation), Cartesian3.ZERO, result);
}

export function readSatelliteSamples(payload) {
  if (!Array.isArray(payload?.positions) || payload.positions.length < 2 || payload.positions.length > 20000) throw new Error("Invalid satellite sample count");
  let previous;
  return payload.positions.map(sample => {
    if (![sample.latitude, sample.longitude, sample.altitude_km].every(value => Number.isFinite(value)) || Math.abs(sample.latitude) > 90 || Math.abs(sample.longitude) > 180) throw new Error("Invalid satellite coordinates");
    // Do not interpret an ambiguous local timestamp as UTC.
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(sample.timestamp || "")) throw new Error("Satellite timestamp needs a UTC offset");
    const time = JulianDate.fromIso8601(sample.timestamp);
    if (previous && JulianDate.lessThanOrEquals(time, previous)) throw new Error("Satellite timestamps must increase");
    previous = time;
    if(sample.teme_position_km) {
      if(payload.reference_frame !== "TEME" || payload.position_unit !== "km" || payload.velocity_unit !== "km/s") throw new Error("Unsupported satellite frame/units");
      const vectors=[sample.teme_position_km,sample.teme_velocity_km_s,sample.itrs_position_km];
      if(vectors.some(v=>!Array.isArray(v) || v.length!==3 || !v.every(Number.isFinite)) || !Number.isFinite(sample.ut1_minus_utc_seconds) || Math.abs(sample.ut1_minus_utc_seconds)>2) throw new Error("Invalid Cartesian satellite state");
      const cartesian=v=>Cartesian3.multiplyByScalar(Cartesian3.fromElements(...v),1000,new Cartesian3());
      return {time,fixed:cartesian(sample.itrs_position_km),inertial:cartesian(sample.teme_position_km),velocity:cartesian(sample.teme_velocity_km_s),dut1:sample.ut1_minus_utc_seconds};
    }
    const fixed = Cartesian3.fromDegrees(sample.longitude, sample.latitude, sample.altitude_km * 1000);
    Matrix3.transpose(Transforms.computeTemeToPseudoFixedMatrix(time, rotation), inverse);
    return { time, fixed, inertial: Matrix3.multiplyByVector(inverse, fixed, new Cartesian3()),dut1:0 };
  });
}

export function createSatelliteTrack(payload) {
  const track = { samples: [], stale: false };
  const point = new Cartesian3(), matrix = new Matrix4();
  track.merge = next => {
    const incoming = readSatelliteSamples(next), start = incoming[0].time;
    // Retain the previous overlap and history; newer propagation owns its time
    // interval. No HOLD extrapolation may masquerade as a moving current fix.
    const changedElements = track.epoch && next.tle_epoch && track.epoch !== next.tle_epoch;
    const history = changedElements ? [] : track.samples.filter(sample => JulianDate.lessThan(sample.time, start));
    // A substantial real element update is not interpolated into invented
    // coordinates between two propagators; the new valid interval takes over.
    track.samples = [...history, ...incoming].slice(-361);
    track.epoch = next.tle_epoch;
    const derivatives=track.samples.every(sample=>sample.velocity) ? 1 : 0;
    track.sampled = new SampledPositionProperty(undefined,derivatives);
    if(derivatives) track.sampled.setInterpolationOptions({interpolationAlgorithm:HermitePolynomialApproximation,interpolationDegree:3});
    for (const sample of track.samples) track.sampled.addSample(sample.time, sample.inertial, derivatives ? [sample.velocity] : undefined);
    track.start = track.samples[0].time;
    track.stop = track.samples.at(-1).time;
  };
  track.effectiveTime = time => JulianDate.lessThan(time, track.start) ? track.start : JulianDate.greaterThan(time, track.stop) ? track.stop : time;
  track.isStale = time => JulianDate.lessThan(time, track.start) || JulianDate.greaterThan(time, track.stop);
  track.remaining = time => JulianDate.secondsDifference(track.stop, time);
  track.inertialAt = (time, result = new Cartesian3()) => track.sampled.getValue(track.effectiveTime(time), result);
  track.velocityAt = (time,result=new Cartesian3()) => {
    const effective=track.effectiveTime(time);let i=0;
    while(i<track.samples.length-2 && JulianDate.greaterThan(effective,track.samples[i+1].time)) i++;
    const a=track.samples[i],b=track.samples[i+1];
    if(!a.velocity || !b.velocity) return undefined;
    const f=JulianDate.secondsDifference(effective,a.time)/JulianDate.secondsDifference(b.time,a.time);
    return Cartesian3.lerp(a.velocity,b.velocity,Math.max(0,Math.min(1,f)),result);
  };
  track.frameAt = (time,result=new Matrix4()) => {
    const effective=track.effectiveTime(time);
    // DUT1 evolves slowly. Use the nearest received sample; accuracy is bounded
    // by the installed server timescale, not a claim of observed ephemerides.
    let low=0,high=track.samples.length-1;
    while(low<high) {const mid=Math.ceil((low+high)/2);if(JulianDate.lessThanOrEquals(track.samples[mid].time,effective)) low=mid;else high=mid-1;}
    return satelliteFrame(effective,result,track.samples[low].dut1);
  };
  track.fixedAt = (time, result = new Cartesian3()) => Matrix4.multiplyByPoint(track.frameAt(time, matrix), track.inertialAt(time, point), result);
  track.position = new CallbackPositionProperty((time, result) => track.fixedAt(time, result), false);
  track.merge(payload);
  return track;
}

export function createSatelliteOrbitState(payload) {
  const samples = readSatelliteSamples(payload);
  if (samples.length > 2000) throw new Error("Orbit sampling exceeds endpoint bound");
  const start = samples[0].time, duration = JulianDate.secondsDifference(samples.at(-1).time, start);
  const backendPeriod = Number(payload.orbital_period_seconds) || Number(payload.orbital_period_minutes) * 60;
  const period = Number.isFinite(backendPeriod) && backendPeriod > 0 ? backendPeriod : duration;
  if (duration <= 0 || Math.abs(duration / period - 1) > .05) throw new Error("Orbit must span one propagated period");
  // Texture s is vertex index; require uniform temporal sampling for phase.
  samples.forEach((sample, i) => { if (Math.abs(JulianDate.secondsDifference(sample.time, start) - duration * i / (samples.length - 1)) > .1) throw new Error("Orbit timestamps must be uniformly sampled"); });
  return { samples, positions: samples.map(sample => sample.inertial), start, period, duration,
    radius: Math.max(...samples.map(sample => Cartesian3.magnitude(sample.inertial))),
    metadata:payload,epoch:payload.tle_epoch,fetchedAt: Date.now(), matrix: new Matrix4(), phase: 0, distance: 0 };
}

const delta = new Cartesian3(), edge = new Cartesian3(), nearest = new Cartesian3();
export function satelliteOrbitPhase(state, point, time) {
  const count = state.positions.length - 1;
  const predicted = ((JulianDate.secondsDifference(time, state.start) / state.duration % 1) + 1) % 1;
  const centre = Math.floor(predicted * count);
  let best = Infinity, phase = predicted;
  // Timestamp predicts the phase; local projection accounts for rounded period,
  // interpolation and refresh epochs without a cosmetic independent timer.
  for (let offset = -12; offset <= 12; offset++) {
    const index = ((centre + offset) % count + count) % count;
    const a = state.positions[index], b = state.positions[index + 1];
    Cartesian3.subtract(b, a, edge); Cartesian3.subtract(point, a, delta);
    const f = Math.max(0, Math.min(1, Cartesian3.dot(delta, edge) / Cartesian3.magnitudeSquared(edge)));
    Cartesian3.multiplyByScalar(edge, f, nearest); Cartesian3.add(a, nearest, nearest);
    const distance = Cartesian3.distanceSquared(point, nearest);
    if (distance < best) { best = distance; phase = (index + f) / count; }
  }
  state.phase = phase % 1; state.distance = Math.sqrt(best);
  return state.phase;
}

export function satelliteOrbitRefreshDue(data, now = Date.now()) {
  if (!data.orbitState) return true;
  const lifetime = Math.min(300, Math.max(60, data.orbitState.period / 12));
  return data.orbitState.needsRefresh || now - data.orbitState.fetchedAt >= lifetime * 1000 || data.trajectory?.tle_epoch !== data.orbitEpoch;
}

export function satelliteTrajectoryRefreshDue(data, time, now = Date.now()) {
  if (now < (data?.trajectoryRetryAt || 0)) return false;
  return !data?.track || data.track.remaining(time) < 90 || JulianDate.lessThan(time, data.track.start);
}
