import {
  DEFAULT_STARTUP_REGION,
  startupRegionFromCountryCode,
} from "../data/startupRegions.js";

const CACHE_KEY = "orbitwatch_startup_region_v2";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readCache() {
  try {
    const cached = JSON.parse(
      window.localStorage.getItem(CACHE_KEY) || "null",
    );

    if (
      !cached ||
      typeof cached.countryCode !== "string" ||
      !Number.isFinite(cached.savedAt) ||
      Date.now() - cached.savedAt > CACHE_MAX_AGE_MS
    ) {
      return null;
    }

    return startupRegionFromCountryCode(cached.countryCode);
  } catch {
    return null;
  }
}

function writeCache(countryCode) {
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        countryCode,
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Storage is optional.
  }
}

export function getCachedStartupCountry() {
  return readCache() || DEFAULT_STARTUP_REGION;
}

export async function resolveStartupCountry(signal) {
  const cached = readCache();
  if (cached) return cached;

  try {
    const response = await fetch("https://api.country.is/", {
      method: "GET",
      signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Country resolver returned ${response.status}`,
      );
    }

    const payload = await response.json();
    const countryCode = String(
      payload?.country || "",
    ).toUpperCase();

    if (!countryCode) {
      return DEFAULT_STARTUP_REGION;
    }

    // payload.ip is intentionally ignored.
    writeCache(countryCode);

    return startupRegionFromCountryCode(countryCode);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return DEFAULT_STARTUP_REGION;
  }
}
