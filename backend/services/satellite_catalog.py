import json
from pathlib import Path

from repositories.satellite_orbital_data import get_all_orbital_records
from services.orbital_data_service import get_supported_norad_ids

catalog_json_path = (
    Path(__file__).resolve().parent.parent / "data" / "space_object_catalog.json"
)

with open(catalog_json_path, "r") as file:
    catalog_objects = json.load(file)


def get_satellite_catalog() -> dict:
    norad_ids = get_supported_norad_ids()
    database_records = get_all_orbital_records()
    database_map = {}
    catalog_map = {}

    for record in database_records:
        database_map[record["norad_id"]] = record

    for obj in catalog_objects:
        catalog_map[obj["noradId"]] = obj

    objects = []

    for norad_id in norad_ids:
        catalog_object = catalog_map.get(norad_id)
        database_record = database_map.get(norad_id)

        if catalog_object is not None:
            result = dict(catalog_object)
        else:
            name = f"NORAD {norad_id}"

            if database_record is not None:
                name = database_record["object_name"]

            result = {
                "noradId": norad_id,
                "name": name,
                "category": "Other",
                "objectType": "Satellite",
                "operator": "Unknown",
                "country": "Unknown",
                "status": "Active",
                "featured": False,
                "modelFamily": "generic-satellite",
                "modelReadiness": "generic",
                "modelUrl": None,
                "wikiUrl": None,
                "officialUrl": None,
                "description": "Tracked by OrbitWatch using current orbital data.",
                "aliases": [],
            }

        if database_record is not None:
            result["name"] = database_record["object_name"]
            result["orbitalSource"] = database_record["source"]
            result["orbitalDataFetchedAt"] = database_record["fetched_at"].isoformat()
            result["orbitalDataAvailable"] = True
        else:
            result["orbitalSource"] = None
            result["orbitalDataFetchedAt"] = None
            result["orbitalDataAvailable"] = False

        objects.append(result)

    return {
        "objects": objects,
        "count": len(objects),
    }


def is_supported_norad_id(norad_id: int) -> bool:
    norad_ids = get_supported_norad_ids()
    return norad_id in norad_ids
