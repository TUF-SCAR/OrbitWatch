# OrbitWatch

OrbitWatch is a React/Vite/Cesium satellite tracking and Earth observation project with two modes:

- **Live Mode:** real SGP4 satellite positions, Orbit Trace predicted inertial paths, Earth maps, real NOAA temperature/cloud/precipitation/wind fields, Open-Meteo location weather and reported natural events, and travel to47 named celestial destinations.
- **Time Explorer:** a paused selected timestamp, Sun/eight-planet navigation and genuine date-aware NASA MODIS Earth imagery where advertised coverage exists. Missing/future dates use a disclosed fixed reference. Historical satellite/prediction data is explicitly unavailable pending a real archive backend.

One shared Cesium Viewer owns the scene. Python/FastAPI provides JWT authentication and scientific propagation, with explicit dependency-readiness and outage handling. Surface models, procedural populations and approximate celestial ephemerides retain their scientific disclosures.

Development is ongoing toward 1 November 2026 submission. See [submission gaps](docs/SUBMISSION_GAPS.md), [Earth imagery/configuration](docs/EARTH_IMAGERY.md), [satellite rendering](docs/SATELLITE_ORBITS.md), [asset provenance](docs/ASSETS.md) and [local checks](docs/TESTING.md).

Precise orbital frames, rendered-effect findings and validation are documented in [orbit investigation](docs/ORBIT_INVESTIGATION.md); [API usage](docs/API_USAGE.md) covers budgets, ownership and policy requirements.

For reproducible backend installation, environment/CORS configuration, explicit
schema authorization, liveness/readiness and outage recovery, see
[deployment prerequisites](docs/DEPLOYMENT.md). API startup never creates database
tables. [Current completion assessment](docs/COMPLETION_ASSESSMENT.md) distinguishes
working Live features from missing history and unverified deployment.

[Live Weather](docs/WEATHER.md) documents genuine1° GFS global fields, eight local
variables, controls, scientific limitations, installation and shared provider
budgets. Weather is available only on Live Earth; Google3D requires an explicit
user-selected compatible raster map.

[Natural events](docs/NATURAL_EVENTS.md) covers protected EONET/GDACS/USGS reports,
clustering/inspection, source semantics, independent caches/quotas and limitations.
These educational reports are not a public warning service.
