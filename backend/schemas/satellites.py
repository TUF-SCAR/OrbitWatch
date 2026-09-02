from pydantic import BaseModel, Field


class TrajectoryBatchRequest(BaseModel):
    norad_ids: list[int] = Field(min_length=1, max_length=200)
    step_seconds: int = Field(default=5, ge=1, le=300)
    duration_seconds: int = Field(default=120, ge=1, le=86400)
