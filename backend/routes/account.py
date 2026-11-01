"""Explicit account persistence, isolated from auth/readiness and delivery."""
from contextlib import contextmanager
from datetime import time
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from core.database import get_database_session
from core.security import get_current_user
from models.user import User
from models.account import ObservationLocation, NotificationPreferences
from schemas.account import LocationInput, LocationUpdate, LocationResponse, PreferencesInput, PreferencesUpdate, PreferencesResponse, MAX_EVENT_RADIUS_KM

router = APIRouter(prefix="/api/account", tags=["Account settings"])


class AccountFeatureUnavailable(Exception):
    pass


@contextmanager
def account_storage(database):
    try:
        database.execute(select(NotificationPreferences.owner_id).limit(0))
        database.execute(select(ObservationLocation.id).limit(0))
        yield
    except IntegrityError:
        database.rollback()
        raise HTTPException(409, "Location already saved or account settings changed. Reload and try again.") from None
    except SQLAlchemyError:
        # Consume account-only schema failures before the shared DB dependency
        # can mark existing auth/Live readiness unavailable. Never log payloads.
        database.rollback()
        raise AccountFeatureUnavailable() from None


def lock_owner(database, owner_id):
    # Stable parent-row lock serializes caps/defaults/preferences across workers.
    database.scalar(select(User).where(User.id == owner_id).with_for_update())


def locations(database, owner_id):
    return list(database.scalars(select(ObservationLocation).where(ObservationLocation.owner_id == owner_id).order_by(ObservationLocation.created_at, ObservationLocation.id)))


def owned_location(database, owner_id, identity):
    location = database.scalar(select(ObservationLocation).where(ObservationLocation.id == str(identity), ObservationLocation.owner_id == owner_id))
    if not location:
        raise HTTPException(404, "Saved location not found")
    return location


def make_default(database, owner_id, target):
    database.execute(update(ObservationLocation).where(ObservationLocation.owner_id == owner_id, ObservationLocation.is_default.is_(True), ObservationLocation.id != target.id)
                     .values(is_default=False, version=ObservationLocation.version + 1))
    target.is_default = True


def preferences_response(database, owner_id, row=None):
    row = row or database.get(NotificationPreferences, owner_id)
    if row:
        values = {key: getattr(row, key) for key in PreferencesInput.model_fields}
        for key in ("quiet_start", "quiet_end"):
            values[key] = values[key].strftime("%H:%M") if values[key] else None
        # Configuration may tighten after preferences have already been saved.
        # Preserve the stored value honestly; writes must respect the new limit.
        result = dict(values, version=row.version, created_at=row.created_at, updated_at=row.updated_at)
    else:
        result = PreferencesInput(event_radius_km=min(100, MAX_EVENT_RADIUS_KM)).model_dump()
    default = database.scalar(select(ObservationLocation).where(ObservationLocation.owner_id == owner_id, ObservationLocation.is_default.is_(True)))
    result["resolved_quiet_timezone"] = result["quiet_timezone"] if result["quiet_timezone_mode"] == "explicit" else default.timezone if default else None
    return result


@router.get("/locations", response_model=list[LocationResponse])
def list_locations(response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    response.headers["Cache-Control"] = "no-store"
    with account_storage(database):
        # Check both foundation tables so partially applied schema stays unavailable.
        database.execute(select(NotificationPreferences.owner_id).limit(0))
        return locations(database, user.id)


@router.post("/locations", response_model=LocationResponse, status_code=201)
def add_location(body: LocationInput, response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    response.headers["Cache-Control"] = "no-store"
    with account_storage(database):
        lock_owner(database, user.id)
        rows = locations(database, user.id)
        duplicate = next((row for row in rows if float(row.latitude) == body.latitude and float(row.longitude) == body.longitude), None)
        if duplicate:
            if duplicate.name != body.name or duplicate.timezone != body.timezone:
                raise HTTPException(409, "These coordinates are already saved. Edit the existing location.")
            response.status_code = 200  # Retry does not create a second row or reset a default.
            return duplicate
        if len(rows) >= 5:
            raise HTTPException(409, "You can save at most five observation locations")
        row = ObservationLocation(owner_id=user.id, slot=next(slot for slot in range(1, 6) if all(item.slot != slot for item in rows)), **body.model_dump(exclude={"is_default"}), is_default=False)
        database.add(row)
        database.flush()
        if body.is_default or not rows:
            make_default(database, user.id, row)
        database.commit()
        database.refresh(row)
        return row


@router.put("/locations/{location_id}", response_model=LocationResponse)
def edit_location(location_id: UUID, body: LocationUpdate, response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    response.headers["Cache-Control"] = "no-store"
    with account_storage(database):
        lock_owner(database, user.id)
        row = owned_location(database, user.id, location_id)
        if row.version != body.expected_version:
            raise HTTPException(409, "Location changed in another session. Reload before saving.")
        if row.is_default and not body.is_default:
            raise HTTPException(409, "Choose another default location first")
        for key, value in body.model_dump(exclude={"is_default", "expected_version"}).items():
            setattr(row, key, value)
        if body.is_default:
            make_default(database, user.id, row)
        row.version += 1
        database.commit()
        database.refresh(row)
        return row


@router.delete("/locations/{location_id}", status_code=204)
def delete_location(location_id: UUID, expected_version: int = Query(ge=1), user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    with account_storage(database):
        lock_owner(database, user.id)
        row = owned_location(database, user.id, location_id)
        if row.version != expected_version:
            raise HTTPException(409, "Location changed in another session. Reload before removing.")
        was_default = row.is_default
        database.delete(row)
        database.flush()
        remaining = locations(database, user.id)
        if was_default and remaining:
            remaining[0].is_default = True  # Oldest creation time, then UUID.
            remaining[0].version += 1
        if not remaining:
            preferences = database.get(NotificationPreferences, user.id)
            if preferences and preferences.quiet_hours_enabled and preferences.quiet_timezone_mode == "default_location":
                preferences.quiet_hours_enabled = False
                preferences.version += 1
        database.commit()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/notification-preferences", response_model=PreferencesResponse)
def get_preferences(response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    response.headers["Cache-Control"] = "no-store"
    with account_storage(database):
        return preferences_response(database, user.id)


@router.put("/notification-preferences", response_model=PreferencesResponse)
def put_preferences(body: PreferencesUpdate, response: Response, user: User = Depends(get_current_user), database: Session = Depends(get_database_session)):
    response.headers["Cache-Control"] = "no-store"
    with account_storage(database):
        lock_owner(database, user.id)
        row = database.get(NotificationPreferences, user.id)
        if body.expected_version != (row.version if row else 0):
            raise HTTPException(409, "Preferences changed in another session. Reload before saving.")
        if body.quiet_hours_enabled and body.quiet_timezone_mode == "default_location" and not locations(database, user.id):
            raise HTTPException(422, "Save a default location or choose an explicit quiet-hours timezone")
        if not row:
            row = NotificationPreferences(owner_id=user.id, version=0)
            database.add(row)
        for key, value in body.model_dump(exclude={"expected_version"}).items():
            setattr(row, key, time.fromisoformat(value) if key in {"quiet_start", "quiet_end"} and value else value)
        row.version += 1
        database.commit()
        database.refresh(row)
        return preferences_response(database, user.id, row)
