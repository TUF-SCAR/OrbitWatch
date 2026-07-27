from fastapi import APIRouter
from services.satellite_tracker import get_satellite_position

router = APIRouter(prefix="/api/satellites", tags=["Satellites"])


@router.get("/{norad_id}/position")
def satellite_position(norad_id: int):
    satellite_details = get_satellite_position(norad_id)
    return satellite_details
