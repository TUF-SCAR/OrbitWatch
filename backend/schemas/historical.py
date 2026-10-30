from datetime import datetime, timezone
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator
from services.historical_catalog import check_historical_ids


def check_timestamp(value):
    value = value.astimezone(timezone.utc)
    if not datetime(1957, 1, 1, tzinfo=timezone.utc) <= value < datetime(2101, 1, 1, tzinfo=timezone.utc):
        raise ValueError('Scene time must be between 1957 and 2100')
    return value


class HistoricalRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    norad_ids: list[int] = Field(min_length=1, max_length=15)
    timestamp: AwareDatetime
    step_seconds: int = Field(default=5, ge=1, le=60)
    duration_seconds: int = Field(default=300, ge=10, le=3600)
    orbit_samples: int = Field(default=480, ge=32, le=960)

    @field_validator('norad_ids')
    @classmethod
    def allowed_ids(cls, value):
        return check_historical_ids(value)

    @field_validator('timestamp')
    @classmethod
    def valid_timestamp(cls, value):
        return check_timestamp(value)

    @model_validator(mode='after')
    def bounded_samples(self):
        if self.duration_seconds / self.step_seconds > 720:
            raise ValueError('Trajectory exceeds 720 sample intervals')
        return self
