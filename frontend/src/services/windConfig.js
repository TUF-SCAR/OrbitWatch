// All visual tuning lives here. These are presentation budgets, not model resolution.
export const WIND_STYLE = Object.freeze({
  speedMultiplier: 12000, // seconds of steady-field advection per wall-clock second
  trailSeconds: .9,
  trailSegments: 8,
  thickness: 1.15, // CSS pixels; antialiasing is supplied by the shader
  brightness: .7,
  nightGlow: .08, // subtle additional alpha, no bloom/postprocessing
  lifetimeSeconds: 9,
  fadeSeconds: .7,
  warmBirthSeconds: .12, // fast reveal for ordinary respawns; mature speed is unchanged
  zoomRefreshRatio: 1.35, // reciprocal threshold: ~26% closer or 35% farther
  zoomHeightFloor: 100000,
  zoomSettleMs: 180,
  zoomRefreshCooldownMs: 750,
  reseedPerUpdate: 192, // includes eight-step history warm-up; reuse existing buffers
  surfaceHeight: 9000, // visual shell above terrain; DATA remains 10 m wind
  maxLatitude: 85, // avoid longitude singularity; the scalar field still covers poles
  maxStepSeconds: .1,
  closeHeight: 800000,
  wideHeight: 20000000,
  closeSpeedScale: .1, // uniform, camera-dependent visualization time scale
  closeDensityScale: 1,
  wideDensityScale: .25,
  mobileScale: .55,
  overloadMs: 12,
  overloadFrames: 30,
  minimumScale: .35,
  recoveryCpuMs: 6,
  recoveryFrameFactor: 1.75,
  recoveryHealthyMs: 8000,
  recoveryCooldownMs: 12000,
  recoveryStepMs: 2000,
  recoveryStep: .05,
});
export const WIND_PROFILES = Object.freeze({
  performance: { particles: 1800, fps: 24 },
  balanced: { particles: 3200, fps: 30 },
  quality: { particles: 5000, fps: 40 },
});
export function windBudget(quality, width, height) {
  const profile = WIND_PROFILES[quality] || WIND_PROFILES.balanced;
  const mobile = width < 600;
  const t = Math.max(0, Math.min(1, (height - WIND_STYLE.closeHeight) / (WIND_STYLE.wideHeight - WIND_STYLE.closeHeight)));
  return { fps: mobile ? Math.min(24, profile.fps) : profile.fps,
    particles: Math.round(profile.particles * (mobile ? WIND_STYLE.mobileScale : 1) * (WIND_STYLE.closeDensityScale + (WIND_STYLE.wideDensityScale - WIND_STYLE.closeDensityScale) * t)),
    speedMultiplier: WIND_STYLE.speedMultiplier * (WIND_STYLE.closeSpeedScale + (1 - WIND_STYLE.closeSpeedScale) * t) };
}
