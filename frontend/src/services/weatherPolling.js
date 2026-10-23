import { validateTemperatureField } from './temperatureGrid.js';
import { validateModelField } from './weatherFields.js';

const STATES = new Set(['preparing','downloading','decoding','cooldown','failed','unavailable']);

export function temperatureResult(payload, now = Date.now()) {
  if (payload?.values_c) {
    const field = validateTemperatureField(payload);
    if(field.fields)for(const variable of ['clouds','precipitation','wind'])validateModelField(variable,field.fields[variable]);
    const availability = field.availability;
    const waiting = field.state === 'stale' && availability;
    const delay = waiting ? retryDelay(availability) : 600000;
    return { field, availability, delay, notBefore: waiting ? now + delay : 0 };
  }
  if (!STATES.has(payload?.state) || !Number.isFinite(payload?.retry_after_seconds)) {
    throw Error('Unsupported weather status');
  }
  const delay = retryDelay(payload);
  return { field: null, availability: payload, delay, notBefore: now + delay };
}

function retryDelay(status) {
  return Math.max(1000, Math.min(86400000, status.retry_after_seconds * 1000));
}

// One cancellable timer/fetch owner. The gate survives panel/mode reopen and
// manual refresh, so neither can bypass the server's retry deadline.
export function createWeatherPoller({ fetchField, onResult, onError, gate,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const controller = new AbortController();
  let timer;
  async function load() {
    await Promise.resolve();
    if (controller.signal.aborted) return;
    if (gate.notBefore > now()) {
      timer = setTimer(load, Math.min(86400000, gate.notBefore - now()));return;
    }
    let delay;
    try {
      const result = temperatureResult(await fetchField(controller.signal), now());
      if (controller.signal.aborted) return;
      gate.notBefore = result.notBefore;
      onResult(result);delay = result.delay;
    } catch (error) {
      if (controller.signal.aborted) return;
      delay = 60000;gate.notBefore = now() + delay;
      onError(error, {state:error.kind === 'offline' ? 'offline' : 'unavailable',
        retry_after_seconds:60,next_attempt_at:new Date(gate.notBefore).toISOString()});
    }
    timer = setTimer(load, delay);
  }
  return {start:load,stop() {controller.abort();clearTimer(timer);} };
}
