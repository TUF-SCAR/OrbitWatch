const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const AUTH_TOKEN_KEY = "orbitwatch_access_token";
let sessionToken = null;

export class OrbitWatchApiError extends Error {
  constructor(message, status, detail = null) {
    super(message);
    this.name = "OrbitWatchApiError";
    this.status = status;
    this.detail = detail;
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
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal });

  if (!response.ok) {
    let detail = null;
    try {
      const body = await response.json();
      detail = body?.detail ?? null;
    } catch {
      // Non-JSON provider errors use the HTTP status below.
    }

    if (
      response.status === 401 &&
      !path.startsWith("/api/auth/login") &&
      !path.startsWith("/api/auth/register")
    ) {
      clearAccessToken();
      window.dispatchEvent(new CustomEvent("orbitwatch:unauthorized"));
    }

    throw new OrbitWatchApiError(
      typeof detail === "string" ? detail : `Request failed (${response.status}). Please try again.`,
      response.status,
      typeof detail === "string" ? detail : null,
    );
  }

  if (response.status === 204) return null;
  return response.json();
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

export function registerAccount({ username, email, password }) {
  return requestJson("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
}

export function loginAccount({ usernameOrEmail, password }) {
  return requestJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username_or_email: usernameOrEmail, password }),
  });
}

export function fetchCurrentUser(signal) {
  return requestJson("/api/auth/me", { signal });
}
