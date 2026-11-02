"""Canonical account targets; bundled catalogs only, never provider requests."""
import json
from pathlib import Path
from services.natural_event_data import CATEGORIES

DATA = Path(__file__).resolve().parents[1] / "data"
LIVE_IDS = frozenset(json.loads((DATA / "space_objects.json").read_text()))
SATELLITES = {str(row["noradId"]): row for row in json.loads((DATA / "space_object_catalog.json").read_text()) if row["noradId"] in LIVE_IDS}
CELESTIAL = {key: key.title() for key in ("mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "moon")}
EVENTS = frozenset(CATEGORIES.values()) | {"other"}
LIMITS = {"satellite": 20, "celestial": 8, "event": len(EVENTS)}


def target_name(kind, identity):
    if kind == "satellite" and identity in SATELLITES:
        return SATELLITES[identity]["name"]
    if kind == "celestial":
        return CELESTIAL.get(identity)
    if kind == "event" and identity in EVENTS:
        return identity.replace("_", " ").title()
    return None


def target_constraint():
    def values(items):
        return ",".join("'" + item + "'" for item in sorted(items))
    return " OR ".join(f"(kind='{kind}' AND target_id IN ({values(items)}))" for kind, items in (("satellite", SATELLITES), ("celestial", CELESTIAL), ("event", EVENTS)))
