"""Runs under the lifespan scheduler owner, independent of viewer traffic."""
import asyncio
import logging
from services.infrared import infrared, InfraredDisabled


async def run_infrared_refresh_worker():
    while True:
        try:
            await asyncio.to_thread(infrared.refresh_pair)
        except InfraredDisabled:
            pass
        except Exception as error:
            logging.getLogger('orbitwatch.infrared').warning('Cloud preparation deferred (%s)',type(error).__name__)
        await asyncio.sleep(60)
