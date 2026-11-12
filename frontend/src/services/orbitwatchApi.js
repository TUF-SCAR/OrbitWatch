import {timeSatelliteAllowed} from '../data/timeExplorerCatalog.js';
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
    ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs??10000)])
    : AbortSignal.timeout(options.timeoutMs??10000);
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
      ? code === 'account_feature_unavailable' ? 'Saved locations and alert preferences are not available yet. Your account and Live Mode are still available.' : code === "database_unavailable" ? "OrbitWatch's database is temporarily unavailable. Please try again shortly." : "OrbitWatch is temporarily unavailable. Please try again shortly."
      : "OrbitWatch encountered a server error. Please try again.";
    const error = new OrbitWatchApiError(
      response.status >= 500 ? serverMessage : typeof detail === "string" ? detail : `Request failed (${response.status}). Please try again.`,
      response.status,
      response.status < 500 && typeof detail === "string" ? detail : null,
      response.status === 401 ? "unauthorized" : response.status === 503 ? "unavailable" : response.status >= 500 ? "server" : "validation", code,
    );
    if(path.startsWith('/api/weather/location?')&&[429,503].includes(response.status)) {
      const retry=Number(response.headers.get('Retry-After'));
      error.retryAfterSeconds=Number.isFinite(retry)&&retry>0?Math.min(86400,retry):30;
    }
    throw error;
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
export function fetchNaturalEventBoundary(id,signal){return requestJson(`/api/events/${encodeURIComponent(id)}/boundary`,{signal,timeoutMs:25000});}

export function fetchHistoricalWeatherCoverage(signal){return requestJson('/api/historical/weather/coverage',{signal});}
export function fetchHistoricalWeatherSnapshot(time,signal){return requestJson(`/api/historical/weather/snapshot?${new URLSearchParams({timestamp:time.toISOString()})}`,{signal,timeoutMs:20000});}
export function fetchHistoricalWeatherLocation(time,point,signal){return requestJson(`/api/historical/weather/location?${new URLSearchParams({timestamp:time.toISOString(),latitude:point.latitude,longitude:point.longitude})}`,{signal});}

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

export function fetchHistoricalTrajectories(noradIds,timestamp,{signal}={}) {
  if(!noradIds.length || noradIds.length>15 || noradIds.some(id=>!timeSatelliteAllowed(id)) || new Set(noradIds).size!==noradIds.length)throw new Error('Select only the permanent Time Explorer satellites');
  return requestJson('/api/historical/trajectories',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({norad_ids:noradIds,timestamp,step_seconds:5,duration_seconds:300,orbit_samples:480}),signal,
  });
}

export function fetchHistoricalCoverage(signal) { return requestJson('/api/historical/coverage',{signal}); }

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

export function fetchAccountLocations(signal) {return requestJson('/api/account/locations',{signal});}
export function fetchNotificationPreferences(signal) {return requestJson('/api/account/notification-preferences',{signal});}
const accountWrite=(path,method,body,signal)=>requestJson(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
export function addAccountLocation(body,signal) {return accountWrite('/api/account/locations','POST',body,signal);}
export function updateAccountLocation(id,body,signal) {return accountWrite(`/api/account/locations/${encodeURIComponent(id)}`,'PUT',body,signal);}
export function deleteAccountLocation(id,version,signal) {return requestJson(`/api/account/locations/${encodeURIComponent(id)}?expected_version=${version}`,{method:'DELETE',signal});}
export function saveNotificationPreferences(body,signal) {return accountWrite('/api/account/notification-preferences','PUT',body,signal);}
export function fetchAlertSubscriptions(signal) {return requestJson('/api/account/alert-subscriptions',{signal});}
export function followAlertTarget(body,signal) {return accountWrite('/api/account/alert-subscriptions','POST',body,signal);}
export function unfollowAlertTarget(id,signal) {return requestJson(`/api/account/alert-subscriptions/${encodeURIComponent(id)}`,{method:'DELETE',signal});}
export function fetchInbox({cursor,signal}={}) {return requestJson(`/api/account/notifications?${new URLSearchParams({limit:'20',...(cursor?{cursor}:{})})}`,{signal});}
export function fetchInboxCount(signal) {return requestJson('/api/account/notifications/unread-count',{signal});}
export function markInboxRead(id,signal) {return accountWrite(`/api/account/notifications/${encodeURIComponent(id)}/read`,'PUT',{},signal);}
export function markAllInboxRead(signal) {return accountWrite('/api/account/notifications/read-all','POST',{},signal);}
export function dismissInboxItem(id,signal) {return requestJson(`/api/account/notifications/${encodeURIComponent(id)}`,{method:'DELETE',signal});}

export async function fetchVisibilityPreview(kind,locationId,signal) {
  const collection=kind==='satellite'?'satellites':'celestial';
  const data=await requestJson(`/api/account/visibility/${collection}?${new URLSearchParams({location_id:locationId,hours:'24'})}`,{signal,timeoutMs:20000});
  return {...data,collectionKind:kind};
}

export function fetchDeliveryStatus(signal) {return requestJson('/api/account/notification-delivery',{signal});}
export function savePushSubscription(body,signal) {return accountWrite('/api/account/push-subscriptions','POST',body,signal);}
export function revokePushSubscription(id,signal) {return requestJson(`/api/account/push-subscriptions/${encodeURIComponent(id)}`,{method:'DELETE',signal,timeoutMs:4000,keepalive:true});}

export function fetchSmallBodyElements(signal){return requestJson("/api/solar-system/small-bodies",{signal});}
