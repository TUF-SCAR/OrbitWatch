from pydantic import BaseModel


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username_or_email: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str
