import asyncio
from services.orbital_data_service import refresh_orbital_data

refresh_check_interval = 60


async def run_satellite_refresh_worker() -> None:
    while True:
        try:
            result = await asyncio.to_thread(refresh_orbital_data)

            if result.get("refreshed"):
                print(
                    "Orbital refresh complete:",
                    result.get("source"),
                    result.get("saved"),
                )
        except Exception as error:
            print(f"Orbital refresh worker failed: {error}")

        await asyncio.sleep(refresh_check_interval)
