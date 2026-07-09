import logging
import uuid

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.core.auth import get_current_user_id
from app.core.config import settings
from app.core.database import get_db
from app.schemas.schemas import (
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    RegisterResponse,
    UserProfile,
    UserProfileUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# --- /auth/me ---

@router.get("/me", summary="Current authenticated user identity")
def auth_me(user_id: str = Depends(get_current_user_id)) -> dict:
    return {
        "user_id":   user_id,
        "auth_mode": "mock" if settings.mock_auth_enabled else "supabase",
    }


# --- /auth/register ---

@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
async def register(payload: RegisterRequest) -> RegisterResponse:
    """
    Create a new user account.

    Development mode (MOCK_AUTH_ENABLED=true):
        Stores the user in the local SQLite users table and returns a mock response.

    Production mode (MOCK_AUTH_ENABLED=false):
        Proxies the registration request to Supabase Auth and returns the
        access token for the mobile client to use as a Bearer header.
    """
    if settings.mock_auth_enabled:
        return await _mock_register(payload)
    return await _supabase_register(payload)


async def _mock_register(payload: RegisterRequest) -> RegisterResponse:
    new_id = str(uuid.uuid4())
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE email = ?", (payload.email,)
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists.",
            )
        conn.execute(
            "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
            (new_id, payload.email, payload.display_name),
        )
    logger.info("Mock user registered: %s (%s)", payload.email, new_id)
    return RegisterResponse(
        user_id=new_id,
        email=payload.email,
        display_name=payload.display_name,
        access_token=None,
        auth_mode="mock",
    )


async def _supabase_register(payload: RegisterRequest) -> RegisterResponse:
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is not configured.",
        )
    url  = f"{settings.supabase_url.rstrip('/')}/auth/v1/signup"
    body: dict = {"email": payload.email, "password": payload.password}
    if payload.display_name:
        body["data"] = {"display_name": payload.display_name}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                url,
                json=body,
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Content-Type": "application/json",
                },
            )
        except httpx.RequestError as exc:
            logger.error("Supabase signup request failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Could not reach the authentication service.",
            )

    if resp.status_code not in (200, 201):
        error_msg = resp.json().get("msg") or resp.json().get("message") or "Registration failed."
        raise HTTPException(status_code=resp.status_code, detail=error_msg)

    data = resp.json()
    user = data.get("user") or {}
    return RegisterResponse(
        user_id=user.get("id", ""),
        email=user.get("email", payload.email),
        display_name=payload.display_name,
        access_token=data.get("access_token"),
        auth_mode="supabase",
    )


# --- /auth/login ---

@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Sign in to an existing account",
)
async def login(payload: LoginRequest) -> LoginResponse:
    """
    Authenticate with email and password.

    Development mode (MOCK_AUTH_ENABLED=true):
        Looks up the user by email in the local users table and returns a
        mock response. Passwords are not stored in mock mode; any password
        is accepted for an existing email.

    Production mode (MOCK_AUTH_ENABLED=false):
        Proxies credentials to Supabase Auth and returns the Bearer token
        for the mobile client to use in subsequent requests.
    """
    if settings.mock_auth_enabled:
        return await _mock_login(payload)
    return await _supabase_login(payload)


async def _mock_login(payload: LoginRequest) -> LoginResponse:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, email, display_name FROM users WHERE email = ?",
            (payload.email,),
        ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    logger.info("Mock login: %s (%s)", payload.email, row["id"])
    return LoginResponse(
        user_id=row["id"],
        email=row["email"],
        display_name=row["display_name"],
        access_token=None,
        auth_mode="mock",
    )


async def _supabase_login(payload: LoginRequest) -> LoginResponse:
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is not configured.",
        )
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/token?grant_type=password"
    body = {"email": payload.email, "password": payload.password}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                url,
                json=body,
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Content-Type": "application/json",
                },
            )
        except httpx.RequestError as exc:
            logger.error("Supabase login request failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Could not reach the authentication service.",
            )

    if resp.status_code != 200:
        error_msg = (
            resp.json().get("error_description")
            or resp.json().get("msg")
            or "Login failed."
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=error_msg)

    data = resp.json()
    user = data.get("user") or {}
    user_meta = user.get("user_metadata") or {}
    return LoginResponse(
        user_id=user.get("id", ""),
        email=user.get("email", payload.email),
        display_name=user_meta.get("display_name"),
        access_token=data.get("access_token"),
        auth_mode="supabase",
    )


# --- /auth/logout ---

@router.post("/logout", summary="Invalidate the current session")
async def logout(
    authorization: str | None = Header(default=None),
) -> dict:
    """
    End the current user session.

    Development mode: returns success immediately.
    Production mode: revokes the token via Supabase Auth.
    In both cases the mobile client must discard its stored token.
    """
    if settings.mock_auth_enabled:
        return {"message": "Logged out successfully.", "auth_mode": "mock"}

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is not configured.",
        )

    token = authorization.split(" ", 1)[1]
    url   = f"{settings.supabase_url.rstrip('/')}/auth/v1/logout"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            await client.post(
                url,
                headers={
                    "apikey":        settings.supabase_anon_key,
                    "Authorization": f"Bearer {token}",
                },
            )
        except httpx.RequestError as exc:
            logger.warning("Supabase logout request failed: %s", exc)
            return {
                "message": "Session may not have been fully invalidated on the server. Discard your token.",
                "auth_mode": "supabase",
            }

    return {"message": "Logged out successfully.", "auth_mode": "supabase"}


# --- /auth/profile ---

@router.get(
    "/profile",
    response_model=UserProfile,
    summary="Get the current user's profile",
)
def get_profile(user_id: str = Depends(get_current_user_id)) -> UserProfile:
    """
    Returns the current user's stored profile (display name, email).

    In mock mode, looks up the user in the local users table.
    In production, the mobile client can read profile data directly from
    Supabase Auth — this endpoint provides a backend-side copy.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT email, display_name FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    return UserProfile(
        user_id=user_id,
        email=row["email"] if row else None,
        display_name=row["display_name"] if row else None,
        auth_mode="mock" if settings.mock_auth_enabled else "supabase",
    )


@router.patch(
    "/profile",
    response_model=UserProfile,
    summary="Update the current user's display name",
)
def update_profile(
    payload: UserProfileUpdate,
    user_id: str = Depends(get_current_user_id),
) -> UserProfile:
    """
    Update the display name for the current user.

    Creates a users row if one does not yet exist (handles the case where
    the user authenticated via Supabase but the local table has no record).
    """
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO users (id, display_name)
            VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
            """,
            (user_id, payload.display_name),
        )
        row = conn.execute(
            "SELECT email, display_name FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    logger.info("Profile updated for user '%s': display_name='%s'.", user_id, payload.display_name)
    return UserProfile(
        user_id=user_id,
        email=row["email"] if row else None,
        display_name=row["display_name"] if row else None,
        auth_mode="mock" if settings.mock_auth_enabled else "supabase",
    )
