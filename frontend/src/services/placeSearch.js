import { GeocoderService } from "cesium";

// Cesium's geocoder does not expose transport cancellation. Bound our wait and
// ignore late responses so they cannot restore credits or a closed search.
export function createPlaceSearch(geocoder, creditDisplay, requestRender, timeout = 10000) {
  let active = null;
  let disposed = false;
  let credits = [];
  function clearCredits() {
    for (const credit of credits) creditDisplay.removeStaticCredit(credit);
    credits = [];
  }
  return {
    search(query, signal) {
      active?.();
      if (disposed || signal?.aborted) return Promise.reject(new DOMException("Search cancelled", "AbortError"));
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const finish = (error, results) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          active = null;
          if (error) { reject(error); return; }
          try {
            const unique = new Map();
            for (const result of results) {
              for (const credit of GeocoderService.getCreditsFromResult(result) || []) unique.set(credit.id, credit);
            }
            if (!unique.size && geocoder.credit) unique.set(geocoder.credit.id, geocoder.credit);
            clearCredits();
            credits = [...unique.values()];
            for (const credit of credits) creditDisplay.addStaticCredit(credit);
            requestRender();
            resolve(results);
          } catch (creditError) {
            reject(creditError);
          }
        };
        const cancel = () => finish(new DOMException("Search cancelled", "AbortError"));
        active = cancel;
        signal?.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => finish(new Error("Place search timed out. Try again.")), timeout);
        Promise.resolve().then(() => settled ? [] : geocoder.geocode(query)).then(
          (results) => finish(null, results || []), (error) => finish(error),
        );
      });
    },
    destroy() {
      disposed = true;
      active?.();
      clearCredits();
    },
  };
}
