from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class RegisterRequest(BaseModel):
    username: str = Field(max_length=100)
    email: str = Field(max_length=320)
    password: str = Field(max_length=256)


class LoginRequest(BaseModel):
    username_or_email: str = Field(max_length=320)
    password: str = Field(max_length=256)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str
    created_at: datetime
