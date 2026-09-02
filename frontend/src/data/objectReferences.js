const DIRECT_REFERENCES = {
  25544: "https://en.wikipedia.org/wiki/International_Space_Station",
  48274: "https://en.wikipedia.org/wiki/Tianhe_core_module",
  20580: "https://en.wikipedia.org/wiki/Hubble_Space_Telescope",
  25867: "https://en.wikipedia.org/wiki/Chandra_X-ray_Observatory",
  25989: "https://en.wikipedia.org/wiki/XMM-Newton",
  25994: "https://en.wikipedia.org/wiki/Terra_(satellite)",
  27424: "https://en.wikipedia.org/wiki/Aqua_(satellite)",
  28376: "https://en.wikipedia.org/wiki/Aura_(satellite)",
  28485: "https://en.wikipedia.org/wiki/Neil_Gehrels_Swift_Observatory",
  29479: "https://en.wikipedia.org/wiki/Hinode_(satellite)",
  33053: "https://en.wikipedia.org/wiki/Fermi_Gamma-ray_Space_Telescope",
  38358: "https://en.wikipedia.org/wiki/NuSTAR",
  39084: "https://en.wikipedia.org/wiki/Landsat_8",
  39634: "https://en.wikipedia.org/wiki/Sentinel-1",
  40697: "https://en.wikipedia.org/wiki/Sentinel-2",
  41335: "https://en.wikipedia.org/wiki/Sentinel-3",
  42063: "https://en.wikipedia.org/wiki/Sentinel-2",
  43435: "https://en.wikipedia.org/wiki/Transiting_Exoplanet_Survey_Satellite",
  43437: "https://en.wikipedia.org/wiki/Sentinel-3",
  43613: "https://en.wikipedia.org/wiki/ICESat-2",
  49260: "https://en.wikipedia.org/wiki/Landsat_9",
  54754: "https://en.wikipedia.org/wiki/Surface_Water_and_Ocean_Topography",
  41752: "https://en.wikipedia.org/wiki/INSAT-3DR",
  41836: "https://en.wikipedia.org/wiki/Himawari_9",
  41866: "https://en.wikipedia.org/wiki/GOES-16",
  43013: "https://en.wikipedia.org/wiki/NOAA-20",
  51850: "https://en.wikipedia.org/wiki/GOES-18",
  54234: "https://en.wikipedia.org/wiki/NOAA-21",
  58990: "https://en.wikipedia.org/wiki/INSAT-3DS",
};

// N2YO exposes a direct NORAD-specific information page for objects that do
// not have a dedicated encyclopaedia article. This keeps the button useful for
// every catalogue entry without guessing a Wikipedia slug.
export function getObjectReferenceUrl(object) {
  if (!object?.noradId) return null;
  return DIRECT_REFERENCES[object.noradId] || `https://www.n2yo.com/satellite/?s=${object.noradId}`;
}
