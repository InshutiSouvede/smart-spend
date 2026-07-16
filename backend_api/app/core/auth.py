import logging
from functools import lru_cache

import httpx
import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_jwks_client() -> PyJWKClient:
    """
    Create a cached JWKS client for fetching Supabase public keys.
    This automatically handles ES256 token verification.
    """
    if not settings.supabase_url:
        raise ValueError("SUPABASE_URL must be set for JWT verification")
    
    jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return PyJWKClient(jwks_url)


async def get_current_user_id(
    authorization: str | None = Header(default=None),
) -> str:
    """
    Resolve the authenticated user ID from the request.

    Development mode (MOCK_AUTH_ENABLED=true):
        Returns MOCK_USER_ID without token validation.

    Production mode (MOCK_AUTH_ENABLED=false):
        Verifies the Bearer JWT using Supabase's public key (supports ES256)
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

    try:
        # Get the signing key from Supabase JWKS endpoint
        jwks_client = get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        
        # Decode and verify the token
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "HS256", "RS256"],  # Support common algorithms
            audience="authenticated",
            options={"verify_aud": True},
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
    except Exception as exc:
        logger.error("Unexpected error during JWT verification: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed.",
            headers={"WWW-Authenticate": "Bearer"},
        )
