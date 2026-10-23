import asyncio
import random
import logging
from services.orbital_data_service import refresh_orbital_data

refresh_check_interval = 60


async def run_satellite_refresh_worker() -> None:
    failures = 0
    while True:
        try:
            result = await asyncio.to_thread(refresh_orbital_data)
            failures = 0

            if result.get("refreshed"):
                print(
                    "Orbital refresh complete:",
                    result.get("source"),
                    result.get("saved"),
                )
        except Exception as error:
            failures = min(failures + 1, 5)
            logging.getLogger("orbitwatch.refresh").warning("Orbital refresh deferred (%s)", type(error).__name__)

        await asyncio.sleep(min(900, refresh_check_interval * 2 ** failures) + random.uniform(0, 15))
