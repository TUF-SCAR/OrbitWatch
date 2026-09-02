const EONET_EVENTS_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200";

export async function fetchOpenDisasterEvents(signal) {
  const response = await fetch(EONET_EVENTS_URL, { signal });
  if (!response.ok) throw new Error(`EONET request failed (${response.status})`);
  const payload = await response.json();
  return Array.isArray(payload?.events) ? payload.events : [];
}
