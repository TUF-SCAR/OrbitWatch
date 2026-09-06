import asyncio
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.database import DatabaseBase, database_engine
from models.user import User
from models.satellite_orbital_data import (
    SatelliteOrbitalData,
    SatelliteOrbitalDataHistory,
)
from routes.auth import router as auth_router
from routes.satellites import router as satellite_router
from services.orbital_data_service import refresh_orbital_data
from workers.satellite_refresh import run_satellite_refresh_worker

allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    DatabaseBase.metadata.create_all(bind=database_engine)

    try:
        result = await asyncio.to_thread(refresh_orbital_data)
        print(f"Startup orbital data check: {result.get('reason')}")
    except Exception as error:
        print(f"Startup orbital data check failed: {error}")

    refresh_task = asyncio.create_task(run_satellite_refresh_worker())

    yield

    refresh_task.cancel()

    try:
        await refresh_task
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(satellite_router)
app.include_router(auth_router)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
