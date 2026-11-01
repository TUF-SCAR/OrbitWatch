from datetime import datetime
from os import getenv
from typing import Annotated, Literal
from unicodedata import category
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Deployments may lower/raise the API bound within the database's fixed hard cap.
MAX_EVENT_RADIUS_KM = int(getenv("ORBITWATCH_MAX_EVENT_RADIUS_KM", "500"))
if not 1 <= MAX_EVENT_RADIUS_KM <= 2000:
    raise RuntimeError("ORBITWATCH_MAX_EVENT_RADIUS_KM must be between 1 and 2000")


def valid_timezone(value: str) -> str:
    if not value or len(value) > 64 or value.startswith(("posix/", "right/")) or value == "localtime":
        raise ValueError("Choose a valid IANA timezone")
    try:
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("Choose a valid IANA timezone") from None
    return value


class AccountInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LocationInput(AccountInput):
    name: str = Field(min_length=1, max_length=80)
    latitude: float = Field(strict=True, allow_inf_nan=False, ge=-90, le=90)
    longitude: float = Field(strict=True, allow_inf_nan=False, ge=-180, le=180)
    timezone: str = Field(min_length=1, max_length=64)
    is_default: bool = Field(default=False, strict=True)

    @field_validator("name")
    @classmethod
    def visible_name(cls, value):
        if any(category(char) in {"Cc", "Cf"} for char in value):
            raise ValueError("Location names cannot contain control characters")
        return value

    @field_validator("timezone")
    @classmethod
    def timezone_name(cls, value):
        return valid_timezone(value)

    @field_validator("latitude", "longitude")
    @classmethod
    def coordinate_precision(cls, value):
        return round(value, 6)


class LocationUpdate(LocationInput):
    expected_version: int = Field(strict=True, ge=1)


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    latitude: float
    longitude: float
    timezone: str
    is_default: bool
    version: int
    created_at: datetime
    updated_at: datetime


ClockText = Annotated[str, Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")]


class PreferencesInput(AccountInput):
    notifications_enabled: bool = Field(default=False, strict=True)
    satellite_alerts: bool = Field(default=False, strict=True)
    celestial_alerts: bool = Field(default=False, strict=True)
    natural_event_alerts: bool = Field(default=False, strict=True)
    advance_warning_minutes: Literal[10, 30, 60] = 30
    event_radius_km: int = Field(default=min(100, MAX_EVENT_RADIUS_KM), strict=True, ge=1, le=MAX_EVENT_RADIUS_KM)
    quiet_hours_enabled: bool = Field(default=False, strict=True)
    quiet_start: ClockText | None = None
    quiet_end: ClockText | None = None
    quiet_timezone_mode: Literal["default_location", "explicit"] = "default_location"
    quiet_timezone: str | None = None

    @field_validator("quiet_timezone")
    @classmethod
    def timezone_name(cls, value):
        return valid_timezone(value) if value is not None else None

    @model_validator(mode="after")
    def quiet_configuration(self):
        if self.quiet_hours_enabled and self.quiet_timezone_mode == "explicit" and not self.quiet_timezone:
            raise ValueError("Choose an explicit IANA timezone")
        if self.quiet_timezone_mode == "default_location" and self.quiet_timezone is not None:
            raise ValueError("Default-location mode uses the saved location timezone")
        if self.quiet_hours_enabled and (not self.quiet_start or not self.quiet_end or self.quiet_start == self.quiet_end):
            raise ValueError("Quiet hours require different start and end times")
        return self


class PreferencesUpdate(PreferencesInput):
    expected_version: int = Field(strict=True, ge=0)


class PreferencesResponse(PreferencesInput):
    event_radius_km: int = Field(default=100, ge=1, le=2000)
    version: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    resolved_quiet_timezone: str | None = None
    max_event_radius_km: int = MAX_EVENT_RADIUS_KM
    delivery_active: Literal[False] = False
