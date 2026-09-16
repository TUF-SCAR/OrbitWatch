export const CELESTIAL_BODIES = {
  sun: { id: "sun", name: "Sun", type: "Star", parent: null, radiusKm: 696340, color: "#ffb33c", texture: "/textures/planets/sun.jpg" },

  mercury: { id: "mercury", name: "Mercury", type: "Planet", parent: "sun", radiusKm: 2439.7, color: "#aaa59f", orbitColor: "rgba(170,165,159,.24)", texture: "/textures/planets/mercury.jpg" },
  venus: { id: "venus", name: "Venus", type: "Planet", parent: "sun", radiusKm: 6051.8, color: "#dfa85b", orbitColor: "rgba(223,168,91,.24)", texture: "/textures/planets/venus.jpg" },
  earth: { id: "earth", name: "Earth", type: "Planet", parent: "sun", radiusKm: 6371.0088, color: "#4d9ff5", orbitColor: "rgba(77,159,245,.27)", texture: "/textures/planets/earth.jpg" },
  mars: { id: "mars", name: "Mars", type: "Planet", parent: "sun", radiusKm: 3389.5, color: "#c95d3c", orbitColor: "rgba(201,93,60,.25)", texture: "/textures/planets/mars.jpg" },
  jupiter: { id: "jupiter", name: "Jupiter", type: "Planet", parent: "sun", radiusKm: 69911, color: "#d4b18f", orbitColor: "rgba(212,177,143,.25)", texture: "/textures/planets/jupiter.jpg", rings: [1.65, 2.20] },
  saturn: { id: "saturn", name: "Saturn", type: "Planet", parent: "sun", radiusKm: 58232, color: "#dfc68d", orbitColor: "rgba(223,198,141,.25)", texture: "/textures/planets/saturn.jpg", rings: [1.30, 1.52, 1.78, 2.04, 2.28] },
  uranus: { id: "uranus", name: "Uranus", type: "Planet", parent: "sun", radiusKm: 25362, color: "#8ed5d9", orbitColor: "rgba(142,213,217,.25)", texture: "/textures/planets/uranus.jpg", rings: [1.62, 1.82, 2.02] },
  neptune: { id: "neptune", name: "Neptune", type: "Planet", parent: "sun", radiusKm: 24622, color: "#4f76df", orbitColor: "rgba(79,118,223,.27)", texture: "/textures/planets/neptune.jpg", rings: [1.62, 2.10, 2.54] },

  moon: { id: "moon", name: "Moon", type: "Moon", parent: "earth", radiusKm: 1737.4, color: "#b8b9b7", texture: "/textures/planets/moon.jpg" },
  phobos: { id: "phobos", name: "Phobos", type: "Moon", parent: "mars", radiusKm: 11.27, color: "#aa927e", texture: "/textures/planets/phobos.jpg" },
  deimos: { id: "deimos", name: "Deimos", type: "Moon", parent: "mars", radiusKm: 6.2, color: "#95897c", texture: "/textures/planets/deimos.jpg" },

  io: { id: "io", name: "Io", type: "Moon", parent: "jupiter", radiusKm: 1821.6, color: "#e7c56d", texture: "/textures/planets/io.jpg" },
  europa: { id: "europa", name: "Europa", type: "Moon", parent: "jupiter", radiusKm: 1560.8, color: "#d8c8ad", texture: "/textures/planets/europa.jpg" },
  ganymede: { id: "ganymede", name: "Ganymede", type: "Moon", parent: "jupiter", radiusKm: 2634.1, color: "#948d7e", texture: "/textures/planets/ganymede.jpg" },
  callisto: { id: "callisto", name: "Callisto", type: "Moon", parent: "jupiter", radiusKm: 2410.3, color: "#675d55", texture: "/textures/planets/callisto.jpg" },

  mimas: { id: "mimas", name: "Mimas", type: "Moon", parent: "saturn", radiusKm: 198.2, color: "#c9c8c3" },
  enceladus: { id: "enceladus", name: "Enceladus", type: "Moon", parent: "saturn", radiusKm: 252.1, color: "#e8eef3", texture: "/textures/planets/enceladus.jpg" },
  tethys: { id: "tethys", name: "Tethys", type: "Moon", parent: "saturn", radiusKm: 531.1, color: "#d0cfca" },
  dione: { id: "dione", name: "Dione", type: "Moon", parent: "saturn", radiusKm: 561.4, color: "#bebeba" },
  rhea: { id: "rhea", name: "Rhea", type: "Moon", parent: "saturn", radiusKm: 763.8, color: "#b9b9b6", texture: "/textures/planets/rhea.jpg" },
  titan: { id: "titan", name: "Titan", type: "Moon", parent: "saturn", radiusKm: 2574.7, color: "#cf9f55", texture: "/textures/planets/titan.jpg" },
  iapetus: { id: "iapetus", name: "Iapetus", type: "Moon", parent: "saturn", radiusKm: 734.5, color: "#8f877c", texture: "/textures/planets/iapetus.jpg" },

  miranda: { id: "miranda", name: "Miranda", type: "Moon", parent: "uranus", radiusKm: 235.8, color: "#b9c1c8" },
  ariel: { id: "ariel", name: "Ariel", type: "Moon", parent: "uranus", radiusKm: 578.9, color: "#d7dde2", texture: "/textures/planets/ariel.jpg" },
  umbriel: { id: "umbriel", name: "Umbriel", type: "Moon", parent: "uranus", radiusKm: 584.7, color: "#7f858b" },
  titania: { id: "titania", name: "Titania", type: "Moon", parent: "uranus", radiusKm: 788.9, color: "#a8b3bf", texture: "/textures/planets/titania.jpg" },
  oberon: { id: "oberon", name: "Oberon", type: "Moon", parent: "uranus", radiusKm: 761.4, color: "#9299a1", texture: "/textures/planets/oberon.jpg" },

  proteus: { id: "proteus", name: "Proteus", type: "Moon", parent: "neptune", radiusKm: 210, color: "#8f8880", texture: "/textures/planets/proteus.jpg" },
  triton: { id: "triton", name: "Triton", type: "Moon", parent: "neptune", radiusKm: 1353.4, color: "#d6cfca", texture: "/textures/planets/triton.jpg" },

  charon: { id: "charon", name: "Charon", type: "Moon", parent: "pluto", radiusKm: 606, color: "#aaa19a", texture: "/textures/planets/charon.jpg" },
  styx: { id: "styx", name: "Styx", type: "Moon", parent: "pluto", radiusKm: 5.2, color: "#aaa6a2" },
  nix: { id: "nix", name: "Nix", type: "Moon", parent: "pluto", radiusKm: 24.9, color: "#c8c1bb" },
  kerberos: { id: "kerberos", name: "Kerberos", type: "Moon", parent: "pluto", radiusKm: 9.5, color: "#9e9995" },
  hydra: { id: "hydra", name: "Hydra", type: "Moon", parent: "pluto", radiusKm: 25.4, color: "#d4ccc5" },

  ceres: { id: "ceres", name: "Ceres", type: "Dwarf Planet", parent: "sun", radiusKm: 469.7, color: "#77746e", orbitColor: "rgba(139,133,122,.18)", texture: "/textures/planets/ceres.jpg" },
  pluto: { id: "pluto", name: "Pluto", type: "Dwarf Planet", parent: "sun", radiusKm: 1188.3, color: "#b5a38e", orbitColor: "rgba(181,163,142,.18)", texture: "/textures/planets/pluto.jpg" },
  eris: { id: "eris", name: "Eris", type: "Dwarf Planet", parent: "sun", radiusKm: 1163, color: "#dce1e5", orbitColor: "rgba(220,225,229,.16)", texture: "/textures/planets/eris.jpg" },
  haumea: { id: "haumea", name: "Haumea", type: "Dwarf Planet", parent: "sun", radiusKm: 780, color: "#d8dbd8", orbitColor: "rgba(216,219,216,.16)", texture: "/textures/planets/haumea.jpg" },
  makemake: { id: "makemake", name: "Makemake", type: "Dwarf Planet", parent: "sun", radiusKm: 715, color: "#ad8e72", orbitColor: "rgba(173,142,114,.16)", texture: "/textures/planets/makemake.jpg" },

  vesta: { id: "vesta", name: "Vesta", type: "Asteroid", parent: "sun", radiusKm: 262.7, color: "#8b8780", orbitColor: "rgba(139,135,128,.14)" },
  pallas: { id: "pallas", name: "Pallas", type: "Asteroid", parent: "sun", radiusKm: 256, color: "#87847d", orbitColor: "rgba(135,132,125,.14)" },
  hygiea: { id: "hygiea", name: "Hygiea", type: "Asteroid", parent: "sun", radiusKm: 217, color: "#706d68", orbitColor: "rgba(112,109,104,.14)" },
  eros: { id: "eros", name: "Eros", type: "Asteroid", parent: "sun", radiusKm: 8.4, color: "#92765e", orbitColor: "rgba(146,118,94,.14)" },
  bennu: { id: "bennu", name: "Bennu", type: "Asteroid", parent: "sun", radiusKm: .246, color: "#4f4c49", orbitColor: "rgba(120,116,111,.12)" },
  apophis: { id: "apophis", name: "Apophis", type: "Asteroid", parent: "sun", radiusKm: .185, color: "#6a6258", orbitColor: "rgba(120,108,94,.12)" },
  psyche: { id: "psyche", name: "Psyche", type: "Asteroid", parent: "sun", radiusKm: 113, color: "#78716b", orbitColor: "rgba(120,113,107,.14)" },
};

export const CELESTIAL_GROUPS = {
  Star: ["sun"],
  Planet: ["mercury","venus","earth","mars","jupiter","saturn","uranus","neptune"],
  Moon: [
    "moon",
    "phobos","deimos",
    "io","europa","ganymede","callisto",
    "mimas","enceladus","tethys","dione","rhea","titan","iapetus",
    "miranda","ariel","umbriel","titania","oberon",
    "proteus","triton",
    "charon","styx","nix","kerberos","hydra"
  ],
  "Dwarf Planet": ["ceres","pluto","eris","haumea","makemake"],
  Asteroid: ["vesta","pallas","hygiea","eros","bennu","apophis","psyche"],
};

export const SOLAR_PLANETS = CELESTIAL_GROUPS.Planet;
export const ALL_CELESTIAL_IDS = Object.keys(CELESTIAL_BODIES);
