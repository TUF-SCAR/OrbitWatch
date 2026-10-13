# OrbitWatch

OrbitWatch is a React/Vite/Cesium satellite tracking and Earth observation project with two modes:

- **Live Mode:** real SGP4 satellite positions, Guided (schematic) or Scientific orbit display, Earth maps and travel to 47 named celestial destinations.
- **Time Explorer:** a paused selected timestamp, Sun/eight-planet navigation and genuine date-aware NASA MODIS Earth imagery where advertised coverage exists. Missing/future dates use a disclosed fixed reference. Historical satellite/prediction data is explicitly unavailable pending a real archive backend.

One shared Cesium Viewer owns the scene. Existing Python/FastAPI authentication and scientific propagation remain unchanged. Surface models, procedural populations and approximate celestial ephemerides retain their scientific disclosures.

Development is ongoing toward 1 November 2026 submission. See [submission gaps](docs/SUBMISSION_GAPS.md), [Earth imagery/configuration](docs/EARTH_IMAGERY.md), [satellite rendering](docs/SATELLITE_ORBITS.md), [asset provenance](docs/ASSETS.md) and [local checks](docs/TESTING.md).
