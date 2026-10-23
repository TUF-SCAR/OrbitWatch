import asyncio
import logging
import uvicorn
from contextlib import asynccontextmanager, nullcontext
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from core.database import database_availability
from core.availability import DatabaseUnavailable
from core.config import cors_origins, enabled
from models.user import User
from models.satellite_orbital_data import (
    SatelliteOrbitalData,
    SatelliteOrbitalDataHistory,
)
from routes.auth import router as auth_router
from routes.satellites import router as satellite_router
from routes.weather import router as weather_router
from routes.natural_events import router as events_router
from services.natural_events import shutdown as shutdown_events
from workers.satellite_refresh import run_satellite_refresh_worker
from services.providers.budget import refresh_owner

allowed_origins = cors_origins()
logger = logging.getLogger("orbitwatch.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # A same-host scheduler lease stays owned through the lifespan. Other API
    # workers serve requests without duplicating startup/scheduled ingestion.
    with (refresh_owner('scheduler-owner.lock') if enabled("ORBITWATCH_INGESTION_ENABLED") else nullcontext(False)) as owner:
        refresh_task = None
        if owner and enabled("ORBITWATCH_INGESTION_ENABLED"):
            refresh_task = asyncio.create_task(run_satellite_refresh_worker())
        try:
            yield
        finally:
            shutdown_events()
            if refresh_task:
                refresh_task.cancel()
                try:
                    await refresh_task
                except asyncio.CancelledError:
                    pass


app = FastAPI(lifespan=lifespan)
app.include_router(satellite_router)
app.include_router(auth_router)
app.include_router(weather_router)
app.include_router(events_router)


@app.get("/health/live", include_in_schema=False)
def live():
    return {"status": "live"}


@app.get("/health/ready", include_in_schema=False)
def ready():
    database_availability.ensure()
    return {"status": "ready", "database": "available"}


@app.exception_handler(DatabaseUnavailable)
async def database_unavailable(request: Request, error: DatabaseUnavailable):
    return JSONResponse(status_code=503, headers={"Retry-After": "5", "Cache-Control": "no-store"},
                        content={"detail": "Database temporarily unavailable. Please try again shortly.", "code": "database_unavailable"})


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    # Pydantic's default response can echo entire submitted credentials in input.
    return JSONResponse(status_code=422, content={"detail": [
        {key: item[key] for key in ("loc", "msg", "type")} for item in error.errors()]})


@app.exception_handler(Exception)
async def unexpected_error(request: Request, error: Exception):
    logger.error("Unhandled API failure method=%s route=%s type=%s", request.method,
                 getattr(request.scope.get("route"), "path", "unknown"), type(error).__name__)
    return JSONResponse(status_code=500, headers={"Cache-Control": "no-store"},
                        content={"detail": "An unexpected server error occurred. Please try again.", "code": "server_error"})


@app.middleware("http")
async def safe_error_boundary(request: Request, call_next):
    # Starlette's outer 500 handler re-raises after responding, which would let
    # the ASGI server log an unsanitized original exception/traceback. Consume
    # unexpected JSON-route failures here, before that outer logging boundary.
    try:
        return await call_next(request)
    except Exception as error:
        return await unexpected_error(request, error)


# CORS surrounds the safe boundary, including its generated 500 responses.
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins,
                   allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
