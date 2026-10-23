const API_BASE = (import.meta.env?.VITE_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const AUTH_TOKEN_KEY = "orbitwatch_access_token";
let sessionToken = null;

export class OrbitWatchApiError extends Error {
  constructor(message, status, detail = null, kind = "request", code = null) {
    super(message);
    this.name = "OrbitWatchApiError";
    this.status = status;
    this.detail = detail;
    this.kind = kind;
    this.code = code;
  }
}

export function getStoredAccessToken() {
  try { return window.localStorage.getItem(AUTH_TOKEN_KEY) || sessionToken; } catch { return sessionToken; }
}

export function storeAccessToken(token) {
  sessionToken = token || null;
  try { if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token); } catch { /* Private browsing can keep the session in memory. */ }
}

export function clearAccessToken() {
  sessionToken = null;
  try { window.localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* In-memory session is already cleared. */ }
}

async function requestJson(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getStoredAccessToken();

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
    : AbortSignal.timeout(10000);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const timeout = signal.aborted || error.name === "TimeoutError";
    throw new OrbitWatchApiError(timeout ? "The request timed out. Please try again." : "Cannot reach OrbitWatch. Check your connection and try again.", 0, null, timeout ? "timeout" : "offline");
  }

  if (!response.ok) {
    let detail = null;
    let code = null;
    try {
      const body = await response.json();
      // Weather's safe state envelope carries its legitimate retry deadline.
      // Auth/DB and all other endpoint failures keep the existing error path.
      if (['/api/weather/temperature','/api/weather/fields'].includes(path) && response.status === 503 &&
          ['cooldown','failed','unavailable'].includes(body?.state) &&
          Number.isFinite(body?.retry_after_seconds)) return body;
      if(path==='/api/events'&&response.status===503&&body?.state==='unavailable'&&Array.isArray(body.events)&&body.providers)return body;
      detail = body?.detail ?? null;
      code = body?.code ?? null;
    } catch {
      // Non-JSON provider errors use the HTTP status below.
    }

    if (
      response.status === 401 &&
      !path.startsWith("/api/auth/login") &&
      !path.startsWith("/api/auth/register") && token === getStoredAccessToken()
    ) {
      clearAccessToken();
      window.dispatchEvent(new CustomEvent("orbitwatch:unauthorized"));
    }

    const serverMessage = response.status === 503
      ? code === "database_unavailable" ? "OrbitWatch's database is temporarily unavailable. Please try again shortly." : "OrbitWatch is temporarily unavailable. Please try again shortly."
      : "OrbitWatch encountered a server error. Please try again.";
    throw new OrbitWatchApiError(
      response.status >= 500 ? serverMessage : typeof detail === "string" ? detail : `Request failed (${response.status}). Please try again.`,
      response.status,
      response.status < 500 && typeof detail === "string" ? detail : null,
      response.status === 401 ? "unauthorized" : response.status === 503 ? "unavailable" : response.status >= 500 ? "server" : "validation", code,
    );
  }

  if (response.status === 204) return null;
  try { return await response.json(); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    if (signal.aborted || error.name === "TimeoutError") throw new OrbitWatchApiError("The request timed out. Please try again.", 0, null, "timeout");
    throw new OrbitWatchApiError("OrbitWatch returned an invalid response. Please try again.", 502, null, "server");
  }
}

export function getApiBaseUrl() {
  return API_BASE;
}

export function fetchSatelliteCatalog(signal) {
  return requestJson("/api/satellites/catalog", { signal });
}

export function fetchSatelliteDataStatus(signal) {
  return requestJson("/api/satellites/data-status", { signal });
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

export function fetchSatelliteTrajectories(
  noradIds,
  { stepSeconds = 5, durationSeconds = 180, signal } = {},
) {
  return requestJson("/api/satellites/trajectories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      norad_ids: noradIds,
      step_seconds: stepSeconds,
      duration_seconds: durationSeconds,
    }),
    signal,
  });
}

export function fetchSatelliteOrbit(
  noradId,
  { samples = 360, signal } = {},
) {
  const query = new URLSearchParams({
    samples: String(samples),
  });
  return requestJson(`/api/satellites/${noradId}/orbit?${query}`, { signal });
}

export function registerAccount({ username, email, password, signal }) {
  return requestJson("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
    signal,
  });
}

export function loginAccount({ usernameOrEmail, password, signal }) {
  return requestJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username_or_email: usernameOrEmail, password }),
    signal,
  });
}

export function fetchCurrentUser(signal) {
  return requestJson("/api/auth/me", { signal });
}

export function fetchTemperatureField(signal) { return requestJson('/api/weather/temperature',{signal}); }
export function fetchWeatherFields(signal) { return requestJson('/api/weather/fields',{signal}); }
export function fetchNaturalEvents(signal) { return requestJson('/api/events',{signal}); }
export function fetchLocationWeather(latitude,longitude,signal) {
  return requestJson(`/api/weather/location?${new URLSearchParams({latitude:String(latitude),longitude:String(longitude)})}`,{signal});
}
