from fastapi import APIRouter, HTTPException, Query
from schemas.satellites import TrajectoryBatchRequest
from services.orbital_data_service import get_orbital_data_status
from services.satellite_catalog import (
    get_satellite_catalog,
    is_supported_norad_id,
)
from services.satellite_tracker import (
    get_satellite_position,
    get_satellite_trajectory,
    get_satellite_trajectories,
    get_satellite_orbit,
)

router = APIRouter(prefix="/api/satellites", tags=["Satellites"])


def check_norad_id(norad_id: int) -> None:
    if not is_supported_norad_id(norad_id):
        raise HTTPException(
            status_code=404,
            detail=f"NORAD ID {norad_id} is not in the OrbitWatch catalog",
        )


def convert_satellite_error(error: Exception):
    if isinstance(error, ValueError):
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    if isinstance(error, LookupError):
        raise HTTPException(
            status_code=503,
            detail=str(error),
        )

    raise HTTPException(
        status_code=503,
        detail=f"Satellite data is temporarily unavailable: {error}",
    )


@router.get("/data-status")
def satellite_data_status() -> dict:
    try:
        return get_orbital_data_status()
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=f"Could not read orbital data status: {error}",
        )


@router.post("/trajectories")
def satellite_trajectories(request: TrajectoryBatchRequest) -> dict:
    for norad_id in request.norad_ids:
        check_norad_id(norad_id)

    try:
        satellite_details = get_satellite_trajectories(
            request.norad_ids,
            request.step_seconds,
            request.duration_seconds,
        )
        return satellite_details
    except Exception as error:
        convert_satellite_error(error)


@router.get("/catalog")
def satellite_catalog() -> dict:
    try:
        space_objects = get_satellite_catalog()
        return space_objects
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=f"Could not read satellite catalog: {error}",
        )


@router.get("/{norad_id}/position")
def satellite_position(norad_id: int) -> dict:
    check_norad_id(norad_id)

    try:
        satellite_details = get_satellite_position(norad_id)
        return satellite_details
    except Exception as error:
        convert_satellite_error(error)


@router.get("/{norad_id}/trajectory")
def satellite_trajectory(
    norad_id: int,
    step_seconds: int = Query(default=5, ge=1, le=300),
    duration_seconds: int = Query(default=120, ge=1, le=86400),
) -> dict:
    check_norad_id(norad_id)

    try:
        satellite_details = get_satellite_trajectory(
            norad_id,
            step_seconds,
            duration_seconds,
        )
        return satellite_details
    except Exception as error:
        convert_satellite_error(error)


@router.get("/{norad_id}/orbit")
def satellite_orbit(
    norad_id: int,
    samples: int = Query(default=300, ge=2, le=2000),
) -> dict:
    check_norad_id(norad_id)

    try:
        satellite_details = get_satellite_orbit(norad_id, samples)
        return satellite_details
    except Exception as error:
        convert_satellite_error(error)
