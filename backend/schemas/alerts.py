from datetime import datetime
import re
from typing import Literal
from uuid import UUID
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from schemas.account import AccountInput
from services.account_targets import target_name

Kind = Literal["satellite", "celestial", "event"]


class SubscriptionInput(AccountInput):
    kind: Kind
    target_id: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def supported(self):
        if not target_name(self.kind, self.target_id):
            raise ValueError("Choose a supported Live satellite, planet/Moon or event category")
        return self


class SubscriptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    kind: Kind
    target_id: str
    target_name: str
    created_at: datetime


class TrustedNotificationInput(AccountInput):
    """Internal writer input, deliberately NOT accepted by any public endpoint."""
    kind: Kind
    target_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=400)
    source_at: AwareDatetime
    expires_at: AwareDatetime | None = None
    location_id: UUID | None = None
    dedup_key: str = Field(min_length=1, max_length=160)

    @model_validator(mode="after")
    def navigation_reference(self):
        valid = bool(re.fullmatch(r"(?:eonet|gdacs|usgs):[A-Za-z0-9_:.\-]{1,100}", self.target_id)) if self.kind == "event" else bool(target_name(self.kind, self.target_id))
        if not valid:
            raise ValueError("Unsupported internal notification target")
        return self


class InboxItem(BaseModel):
    id: str
    kind: Kind
    target_id: str
    title: str
    message: str
    location_id: str | None
    location_name: str | None
    source_at: datetime
    expires_at: datetime | None
    created_at: datetime
    read_at: datetime | None
    is_expired: bool
    destination: dict
    source_url: str | None = None
    delivery_state: str | None = None
    alert_stage: str | None = None
    opportunity_id: str | None = None
    viewing_details: dict | None = None
