import logging

import jwt
from fastapi import Header, HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)


async def get_current_user_id(
    authorization: str | None = Header(default=None),
) -> str:
    """
    Resolve the authenticated user ID from the request.

    Development mode (MOCK_AUTH_ENABLED=true):
        Returns MOCK_USER_ID without token validation.

    Production mode (MOCK_AUTH_ENABLED=false):
        Verifies the Bearer JWT using the configured Supabase JWT secret
        and returns the 'sub' claim as the user ID.
    """
    if settings.mock_auth_enabled:
        return settings.mock_user_id

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header. Expected: 'Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1]

    if not settings.supabase_jwt_secret:
        logger.error(
            "SUPABASE_JWT_SECRET is not set but MOCK_AUTH_ENABLED=false. "
            "Authentication cannot proceed."
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is not configured.",
        )

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=[settings.jwt_algorithm],
            audience="authenticated",
        )
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token payload does not contain a valid user identifier.",
            )
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
