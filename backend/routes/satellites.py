from fastapi import APIRouter
from services.satellite_tracker import get_satellite_position, get_satellite_trajectory

router = APIRouter(prefix="/api/satellites", tags=["Satellites"])


@router.get("/{norad_id}/position")
def satellite_position(norad_id: int):
    satellite_details = get_satellite_position(norad_id)
    return satellite_details


@router.get("/{norad_id}/trajectory")
def satellite_trajectory(
    norad_id: int, step_seconds: int = 5, duration_seconds: int = 120
):
    satellite_details = get_satellite_trajectory(
        norad_id, step_seconds, duration_seconds
    )
    return satellite_details
