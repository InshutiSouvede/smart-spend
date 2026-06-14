import logging
import sqlite3
from contextlib import contextmanager

from app.core.config import settings

logger = logging.getLogger(__name__)

_SCHEMA_TABLES = """
CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    display_name TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             TEXT    NOT NULL,
    raw_sms             TEXT,
    transaction_type    TEXT    NOT NULL,
    direction           TEXT    NOT NULL DEFAULT 'OUTGOING',
    amount_rwf          REAL    NOT NULL,
    fee_rwf             REAL    NOT NULL DEFAULT 0.0,
    total_amount_rwf    REAL    NOT NULL DEFAULT 0.0,
    balance_after_rwf   REAL,
    currency            TEXT    NOT NULL DEFAULT 'RWF',
    counterpart         TEXT,
    description         TEXT    NOT NULL,
    category            TEXT,
    confidence          REAL,
    timestamp           TEXT,
    source              TEXT    DEFAULT 'sms',
    created_at          TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS category_corrections (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             TEXT    NOT NULL,
    transaction_id      INTEGER,
    description         TEXT    NOT NULL,
    previous_category   TEXT,
    corrected_category  TEXT    NOT NULL,
    created_at          TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receipts (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 TEXT    NOT NULL,
    file_path               TEXT    NOT NULL,
    original_filename       TEXT,
    extracted_text          TEXT,
    parsed_items_json       TEXT,
    matched_transaction_id  INTEGER,
    ocr_mode                TEXT    DEFAULT 'mock',
    created_at              TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS retraining_jobs (
    job_id          TEXT    PRIMARY KEY,
    user_id         TEXT    NOT NULL,
    model_type      TEXT    NOT NULL,
    status          TEXT    NOT NULL,
    message         TEXT,
    metrics_json    TEXT,
    started_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    completed_at    TEXT
);
"""

_SCHEMA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id
    ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_timestamp
    ON transactions(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_transactions_user_direction
    ON transactions(user_id, direction);
CREATE INDEX IF NOT EXISTS idx_transactions_user_category
    ON transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_corrections_user_id
    ON category_corrections(user_id);
CREATE INDEX IF NOT EXISTS idx_retraining_jobs_user_id
    ON retraining_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_retraining_jobs_status
    ON retraining_jobs(status);
"""

_TRANSACTION_MIGRATIONS: list[tuple[str, str]] = [
    ("direction",         "TEXT NOT NULL DEFAULT 'OUTGOING'"),
    ("fee_rwf",           "REAL NOT NULL DEFAULT 0.0"),
    ("total_amount_rwf",  "REAL NOT NULL DEFAULT 0.0"),
    ("balance_after_rwf", "REAL"),
    ("currency",          "TEXT NOT NULL DEFAULT 'RWF'"),
]

_RECEIPT_MIGRATIONS: list[tuple[str, str]] = [
    ("ocr_mode", "TEXT DEFAULT 'mock'"),
]


@contextmanager
def get_db():
    """Yield a connected SQLite connection with row_factory and WAL mode enabled."""
    conn = sqlite3.connect(settings.database_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _apply_column_migrations(
    conn: sqlite3.Connection,
    table: str,
    migrations: list[tuple[str, str]],
) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    for col_name, col_def in migrations:
        if col_name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}")
            logger.info("Migration: added column '%s' to '%s'.", col_name, table)


def init_db() -> None:
    """Create tables, apply column migrations, and build indexes."""
    with get_db() as conn:
        conn.executescript(_SCHEMA_TABLES)
        _apply_column_migrations(conn, "transactions", _TRANSACTION_MIGRATIONS)
        _apply_column_migrations(conn, "receipts", _RECEIPT_MIGRATIONS)
        conn.executescript(_SCHEMA_INDEXES)
    logger.info("Database initialised at '%s'.", settings.database_path)
