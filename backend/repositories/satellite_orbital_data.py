from sqlalchemy import delete, func, select
from datetime import datetime, timedelta, timezone
from sqlalchemy.dialects.postgresql import insert
from core.database import database_session_maker
from models.satellite_orbital_data import (
    SatelliteOrbitalData,
    SatelliteOrbitalDataHistory,
)


def parse_spacetrack_datetime(value: str) -> datetime:
    parsed_datetime = datetime.fromisoformat(value.replace("Z", "+00:00"))

    if parsed_datetime.tzinfo is None:
        parsed_datetime = parsed_datetime.replace(tzinfo=timezone.utc)

    return parsed_datetime


def save_orbital_records(
    records: list[dict],
    source: str,
) -> int:
    if not records:
        return 0

    fetched_at = datetime.now(timezone.utc)

    values = []

    for record in records:
        norad_id = record.get("NORAD_CAT_ID")
        object_name = record.get("OBJECT_NAME")
        epoch = record.get("EPOCH")
        tle_line1 = record.get("TLE_LINE1")
        tle_line2 = record.get("TLE_LINE2")

        if not all(
            [
                norad_id,
                object_name,
                epoch,
                tle_line1,
                tle_line2,
            ]
        ):
            continue

        values.append(
            {
                "norad_id": int(norad_id),
                "object_name": object_name,
                "object_id": record.get("OBJECT_ID"),
                "epoch": parse_spacetrack_datetime(epoch),
                "tle_line1": tle_line1,
                "tle_line2": tle_line2,
                "source": source,
                "fetched_at": fetched_at,
                "raw_data": record,
            }
        )

    if not values:
        return 0

    statement = insert(SatelliteOrbitalData).values(values)

    statement = statement.on_conflict_do_update(
        index_elements=["norad_id"],
        set_={
            "object_name": statement.excluded.object_name,
            "object_id": statement.excluded.object_id,
            "epoch": statement.excluded.epoch,
            "tle_line1": statement.excluded.tle_line1,
            "tle_line2": statement.excluded.tle_line2,
            "source": statement.excluded.source,
            "fetched_at": statement.excluded.fetched_at,
            "raw_data": statement.excluded.raw_data,
        },
    )

    with database_session_maker() as session:
        session.execute(statement)
        session.commit()

    return len(values)


def archive_current_orbital_records(norad_ids: list[int]) -> int:
    if not norad_ids:
        return 0

    query = select(SatelliteOrbitalData).where(
        SatelliteOrbitalData.norad_id.in_(norad_ids)
    )

    with database_session_maker() as session:
        objects = session.scalars(query).all()

    if not objects:
        return 0

    values = []

    for obj in objects:
        values.append(
            {
                "norad_id": obj.norad_id,
                "object_name": obj.object_name,
                "object_id": obj.object_id,
                "epoch": obj.epoch,
                "tle_line1": obj.tle_line1,
                "tle_line2": obj.tle_line2,
                "source": obj.source,
                "fetched_at": obj.fetched_at,
                "raw_data": obj.raw_data,
            }
        )

    statement = insert(SatelliteOrbitalDataHistory).values(values)

    statement = statement.on_conflict_do_update(
        index_elements=["norad_id"],
        set_={
            "object_name": statement.excluded.object_name,
            "object_id": statement.excluded.object_id,
            "epoch": statement.excluded.epoch,
            "tle_line1": statement.excluded.tle_line1,
            "tle_line2": statement.excluded.tle_line2,
            "source": statement.excluded.source,
            "fetched_at": statement.excluded.fetched_at,
            "raw_data": statement.excluded.raw_data,
        },
    )

    with database_session_maker() as session:
        session.execute(statement)
        session.commit()

    return len(values)


def delete_old_orbital_history(max_age_seconds: int = 7200) -> int:
    cutoff_time = datetime.now(timezone.utc) - timedelta(seconds=max_age_seconds)

    statement = delete(SatelliteOrbitalDataHistory).where(
        SatelliteOrbitalDataHistory.fetched_at < cutoff_time
    )

    with database_session_maker() as session:
        result = session.execute(statement)
        session.commit()

    return result.rowcount or 0


def get_orbital_record(norad_id: int):
    query = select(
        SatelliteOrbitalData.norad_id,
        SatelliteOrbitalData.object_name,
        SatelliteOrbitalData.epoch,
        SatelliteOrbitalData.tle_line1,
        SatelliteOrbitalData.tle_line2,
        SatelliteOrbitalData.source,
        SatelliteOrbitalData.fetched_at,
    ).where(SatelliteOrbitalData.norad_id == norad_id)

    with database_session_maker() as session:
        obj = session.execute(query).first()

    if obj is not None:
        result = {
            "norad_id": obj.norad_id,
            "object_name": obj.object_name,
            "epoch": obj.epoch,
            "tle_line1": obj.tle_line1,
            "tle_line2": obj.tle_line2,
            "source": obj.source,
            "fetched_at": obj.fetched_at,
            "history": False,
        }

        return result

    history_query = select(
        SatelliteOrbitalDataHistory.norad_id,
        SatelliteOrbitalDataHistory.object_name,
        SatelliteOrbitalDataHistory.epoch,
        SatelliteOrbitalDataHistory.tle_line1,
        SatelliteOrbitalDataHistory.tle_line2,
        SatelliteOrbitalDataHistory.source,
        SatelliteOrbitalDataHistory.fetched_at,
    ).where(SatelliteOrbitalDataHistory.norad_id == norad_id)

    with database_session_maker() as session:
        history_obj = session.execute(history_query).first()

    if history_obj is not None:
        result = {
            "norad_id": history_obj.norad_id,
            "object_name": history_obj.object_name,
            "epoch": history_obj.epoch,
            "tle_line1": history_obj.tle_line1,
            "tle_line2": history_obj.tle_line2,
            "source": history_obj.source,
            "fetched_at": history_obj.fetched_at,
            "history": True,
        }

        return result

    return None


def get_all_orbital_records():
    query = select(
        SatelliteOrbitalData.norad_id,
        SatelliteOrbitalData.object_name,
        SatelliteOrbitalData.epoch,
        SatelliteOrbitalData.tle_line1,
        SatelliteOrbitalData.tle_line2,
        SatelliteOrbitalData.source,
        SatelliteOrbitalData.fetched_at,
    )

    with database_session_maker() as session:
        objects = session.execute(query).all()

    space_objects = []

    for obj in objects:
        space_objects.append(
            {
                "norad_id": obj.norad_id,
                "object_name": obj.object_name,
                "epoch": obj.epoch,
                "tle_line1": obj.tle_line1,
                "tle_line2": obj.tle_line2,
                "source": obj.source,
                "fetched_at": obj.fetched_at,
                "history": False,
            },
        )

    return space_objects


def get_latest_orbital_timestamp():
    query = select(func.max(SatelliteOrbitalData.fetched_at))

    with database_session_maker() as session:
        latest_timestamp = session.scalar(query)

    if latest_timestamp is not None and latest_timestamp.tzinfo is None:
        latest_timestamp = latest_timestamp.replace(tzinfo=timezone.utc)

    return latest_timestamp


def get_oldest_orbital_timestamp(norad_ids: list[int]):
    if not norad_ids:
        return None

    query = select(func.min(SatelliteOrbitalData.fetched_at)).where(
        SatelliteOrbitalData.norad_id.in_(norad_ids)
    )

    with database_session_maker() as session:
        oldest_timestamp = session.scalar(query)

    if oldest_timestamp is not None and oldest_timestamp.tzinfo is None:
        oldest_timestamp = oldest_timestamp.replace(tzinfo=timezone.utc)

    return oldest_timestamp


def get_orbital_record_count() -> int:
    query = select(func.count()).select_from(SatelliteOrbitalData)

    with database_session_maker() as session:
        count = session.scalar(query)

    return int(count or 0)


def get_orbital_history_count() -> int:
    query = select(func.count()).select_from(SatelliteOrbitalDataHistory)

    with database_session_maker() as session:
        count = session.scalar(query)

    return int(count or 0)


if __name__ == "__main__":
    print(get_orbital_record(25544))
