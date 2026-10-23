"""Explicit operator-only initialization for an authorized empty database.

Never invoked by the API; does not upgrade existing schemas. Review the target
out of band and back it up before running against any persistent environment.
"""
import argparse
from core.database import DatabaseBase, database_engine
from models.user import User
from models.satellite_orbital_data import SatelliteOrbitalData, SatelliteOrbitalDataHistory

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create-schema", action="store_true", required=True)
    parser.parse_args()
    DatabaseBase.metadata.create_all(database_engine)
    print("Schema initialization completed; no schema upgrades were performed.")
