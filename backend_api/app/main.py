import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import router as api_router
from app.core.config import settings
from app.core.database import init_db
from app.core.exceptions import SmartSpendException, smartspend_exception_handler
from app.core.logging_config import configure_logging

configure_logging()
logger = logging.getLogger(__name__)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Log and return detailed validation errors for debugging."""
    logger.error("=== Validation Error ===")
    logger.error("URL: %s", request.url)
    logger.error("Method: %s", request.method)
    logger.error("Errors: %s", exc.errors())
    try:
        body = await request.body()
        logger.error("Request body (first 1000 chars): %s", body.decode()[:1000])
    except Exception as e:
        logger.error("Could not log request body: %s", e)
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
    )


app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description=(
        "SmartSpend Backend API — automated MTN Mobile Money and Airtel Money SMS parsing, "
        "expense categorisation (TF-IDF + Logistic Regression), "
        "month-end financial prediction (XGBoost), "
        "receipt OCR, and asynchronous per-user model retraining."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

app.add_exception_handler(SmartSpendException, smartspend_exception_handler)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    logger.info(
        "SmartSpend API started. env=%s mock_auth=%s",
        settings.app_env,
        settings.mock_auth_enabled,
    )


@app.get("/", tags=["System"], summary="API root")
def root() -> dict:
    return {
        "app": "SmartSpend API",
        "version": settings.app_version,
        "status": "running",
    }


@app.get("/health", tags=["System"], summary="API health check")
def health() -> dict:
    return {
        "status":            "ok",
        "environment":       settings.app_env,
        "version":           settings.app_version,
        "mock_auth_enabled": settings.mock_auth_enabled,
    }


app.include_router(api_router)
