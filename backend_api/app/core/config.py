from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Application
    app_env: str = "development"
    app_title: str = "SmartSpend Backend API"
    app_version: str = "1.0.0"

    # Database
    database_path: str = "./smartspend.db"

    # Storage paths
    model_dir: str = "./storage/models"
    # Per-user model artifacts live at: {user_model_dir}/{user_id}/{model_type}.joblib
    user_model_dir: str = "./storage/models/users"
    upload_dir: str = "./storage/uploads"
    retraining_job_dir: str = "./storage/retraining_jobs"

    # Authentication
    mock_auth_enabled: bool = True
    mock_user_id: str = "demo_user_001"
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    # JWT verification now uses JWKS (automatic public key fetching)
    # No manual JWT_ALGORITHM or SUPABASE_JWT_SECRET needed

    # CORS — use JSON array format in .env: ["url1","url2"]
    cors_origins: List[str] = [
        "http://localhost:3000",
        "http://localhost:8081",
        "http://localhost:19006",
    ]
    cors_allow_credentials: bool = False

    # File uploads — use JSON array format in .env: [".jpg",".png"]
    max_upload_size_mb: int = 10
    allowed_upload_extensions: List[str] = [".jpg", ".jpeg", ".png", ".pdf", ".webp"]

    # OCR — PaddleOCR runs locally; no API key required.
    # Install: pip install paddlepaddle paddleocr  (then set PADDLE_OCR_ENABLED=true)
    paddle_ocr_enabled: bool = True

    # Receipt-to-SMS matching thresholds
    receipt_match_amount_tolerance: float = 0.10   # max fractional amount diff (10 %)
    receipt_match_time_window_seconds: int = 7200  # 2 h — time diff at which time_score → 0
    receipt_match_min_confidence: float = 0.65     # scores below this are not auto-matched

    # ML
    min_corrections_for_retraining: int = 5

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        protected_namespaces=("settings_",),
    )


settings = Settings()

# Ensure required directories exist at import time
for _p in [
    settings.model_dir,
    settings.user_model_dir,
    settings.upload_dir,
    settings.retraining_job_dir,
]:
    Path(_p).mkdir(parents=True, exist_ok=True)
