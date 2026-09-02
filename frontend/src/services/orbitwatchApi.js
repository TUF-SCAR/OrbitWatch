const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(`OrbitWatch API ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export function getApiBaseUrl() {
  return API_BASE;
}

export function fetchSatellitePosition(noradId, signal) {
  return requestJson(`/api/satellites/${noradId}/position`, { signal });
}

export function fetchSatelliteTrajectory(
  noradId,
  { stepSeconds = 5, durationSeconds = 120, signal } = {},
) {
  const query = new URLSearchParams({
    step_seconds: String(stepSeconds),
    duration_seconds: String(durationSeconds),
  });
  return requestJson(`/api/satellites/${noradId}/trajectory?${query}`, { signal });
}

// V8 only calls satellite backend routes that already exist. Historical/batch
// APIs remain backend work; complete live orbits reuse the trajectory route.
