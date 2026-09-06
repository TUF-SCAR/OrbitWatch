from datetime import datetime
from pydantic import BaseModel, ConfigDict


class RegisterRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    username_or_email: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str
    created_at: datetime
