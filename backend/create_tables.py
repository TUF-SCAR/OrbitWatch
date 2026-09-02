from models.user import User
from models.satellite_orbital_data import (
    SatelliteOrbitalData,
    SatelliteOrbitalDataHistory,
)
from core.database import DatabaseBase, database_engine

DatabaseBase.metadata.create_all(bind=database_engine)
