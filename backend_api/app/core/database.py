import logging
import sqlite3
from contextlib import contextmanager

from app.core.config import settings

logger = logging.getLogger(__name__)

_SCHEMA_TABLES = """
CREATE TABLE IF NOT EXISTS users (
    id                 TEXT PRIMARY KEY,
    email              TEXT UNIQUE NOT NULL,
    display_name       TEXT,
    last_sms_import_at TEXT,
    created_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

-- SMS financial movements: the money source-of-truth
CREATE TABLE IF NOT EXISTS sms_transactions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id               TEXT    NOT NULL,
    source_message_id     TEXT,
    sender                TEXT,
    raw_sms_text          TEXT    NOT NULL,
    raw_sms_hash          TEXT    NOT NULL,
    sms_time              TEXT,
    transaction_time      TEXT,
    transaction_type      TEXT    NOT NULL CHECK(transaction_type IN ('income', 'expense')),
    amount_rwf            REAL    NOT NULL,
    fee_rwf               REAL    NOT NULL DEFAULT 0.0,
    balance_after_rwf     REAL,
    to_who                TEXT,
    from_who              TEXT,
    transaction_reference TEXT,
    parse_confidence      REAL    DEFAULT 1.0,
    provider              TEXT,
    currency              TEXT    DEFAULT 'RWF',
    created_at            TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- Item-level purchase details: what was actually bought
CREATE TABLE IF NOT EXISTS purchase_details (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id               TEXT    NOT NULL,
    source_type           TEXT    NOT NULL CHECK(source_type IN ('receipt', 'user_prompt')),
    source_id             INTEGER NOT NULL,
    purchase_time         TEXT,
    merchant_name         TEXT,
    item_name             TEXT    NOT NULL,
    normalized_item_name  TEXT,
    quantity              REAL    DEFAULT 1.0,
    unit                  TEXT,
    unit_cost_rwf         REAL,
    total_cost_rwf        REAL    NOT NULL,
    extraction_confidence REAL    DEFAULT 1.0,
    created_at            TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- Receipt upload metadata and OCR state
CREATE TABLE IF NOT EXISTS receipt_uploads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           TEXT    NOT NULL,
    file_path         TEXT    NOT NULL,
    ocr_raw_text      TEXT,
    ocr_status        TEXT    DEFAULT 'pending',
    extraction_status TEXT    DEFAULT 'pending',
    uploaded_at       TEXT    DEFAULT CURRENT_TIMESTAMP,
    processed_at      TEXT
);

-- Links expense SMS transactions to purchase detail rows
CREATE TABLE IF NOT EXISTS transaction_purchase_matches (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id              TEXT    NOT NULL,
    sms_transaction_id   INTEGER NOT NULL,
    purchase_detail_id   INTEGER NOT NULL,
    match_status         TEXT    NOT NULL DEFAULT 'auto_matched'
                         CHECK(match_status IN ('auto_matched', 'user_confirmed', 'unmatched', 'rejected')),
    match_score          REAL,
    matched_by           TEXT    NOT NULL DEFAULT 'system'
                         CHECK(matched_by IN ('system', 'user')),
    created_at           TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- Category predictions and final decisions, one row per purchase_detail
CREATE TABLE IF NOT EXISTS expense_categories (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            TEXT    NOT NULL,
    purchase_detail_id INTEGER NOT NULL UNIQUE,
    predicted_category TEXT,
    confidence         REAL,
    final_category     TEXT,
    category_source    TEXT    NOT NULL DEFAULT 'model'
                       CHECK(category_source IN ('model', 'user_correction', 'rule')),
    corrected_at       TEXT,
    created_at         TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- User-supplied category corrections: personalisation dataset
CREATE TABLE IF NOT EXISTS category_corrections (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id              TEXT    NOT NULL,
    purchase_detail_id   INTEGER,
    item_name            TEXT    NOT NULL,
    normalized_item_name TEXT,
    merchant_name        TEXT,
    to_who               TEXT,
    quantity             REAL,
    unit                 TEXT,
    unit_cost_rwf        REAL,
    total_cost_rwf       REAL,
    purchase_month       INTEGER,
    purchase_weekday     INTEGER,
    previous_category    TEXT,
    corrected_category   TEXT    NOT NULL,
    correction_source    TEXT    DEFAULT 'user',
    created_at           TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- Monthly aggregates for forecast model training and analytics
CREATE TABLE IF NOT EXISTS monthly_financial_aggregates (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                    TEXT    NOT NULL,
    year                       INTEGER NOT NULL,
    month                      INTEGER NOT NULL,
    category                   TEXT,
    total_expense_rwf          REAL    DEFAULT 0.0,
    total_income_rwf           REAL    DEFAULT 0.0,
    expense_transaction_count  INTEGER DEFAULT 0,
    income_transaction_count   INTEGER DEFAULT 0,
    average_expense_amount_rwf REAL,
    average_income_amount_rwf  REAL,
    created_at                 TEXT    DEFAULT CURRENT_TIMESTAMP,
    updated_at                 TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, year, month, category)
);

-- Background ML training job records
CREATE TABLE IF NOT EXISTS retraining_jobs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             TEXT    NOT NULL,
    model_type          TEXT    NOT NULL
                        CHECK(model_type IN (
                            'expense_category',
                            'monthly_expense_forecast',
                            'monthly_income_forecast'
                        )),
    status              TEXT    NOT NULL,
    training_rows_count INTEGER,
    metrics_json        TEXT,
    model_path          TEXT,
    started_at          TEXT    DEFAULT CURRENT_TIMESTAMP,
    completed_at        TEXT,
    error_message       TEXT
);

-- Versioned record of every trained model artifact per user
CREATE TABLE IF NOT EXISTS model_versions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             TEXT    NOT NULL,
    model_type          TEXT    NOT NULL
                        CHECK(model_type IN (
                            'expense_category',
                            'monthly_expense_forecast',
                            'monthly_income_forecast'
                        )),
    version             INTEGER NOT NULL DEFAULT 1,
    model_path          TEXT    NOT NULL,
    metrics_json        TEXT,
    training_rows_count INTEGER,
    is_active           INTEGER NOT NULL DEFAULT 1
                        CHECK(is_active IN (0, 1)),
    retraining_job_id   INTEGER REFERENCES retraining_jobs(id),
    created_at          TEXT    DEFAULT CURRENT_TIMESTAMP
);
"""

_SCHEMA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_dedup_ref
    ON sms_transactions(user_id, transaction_reference)
    WHERE transaction_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_source_message_id
    ON sms_transactions(user_id, source_message_id)
    WHERE source_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_transactions_user_id
    ON sms_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_transactions_user_time
    ON sms_transactions(user_id, transaction_time);
CREATE INDEX IF NOT EXISTS idx_sms_transactions_type
    ON sms_transactions(user_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_purchase_details_user_id
    ON purchase_details(user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_details_source
    ON purchase_details(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_user_id
    ON receipt_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_matches_sms
    ON transaction_purchase_matches(sms_transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_matches_purchase
    ON transaction_purchase_matches(purchase_detail_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_purchase
    ON expense_categories(purchase_detail_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_user
    ON expense_categories(user_id);
CREATE INDEX IF NOT EXISTS idx_corrections_user_id
    ON category_corrections(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_aggregates_user_month
    ON monthly_financial_aggregates(user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_retraining_jobs_user_id
    ON retraining_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_retraining_jobs_status
    ON retraining_jobs(status);
CREATE INDEX IF NOT EXISTS idx_model_versions_user_type
    ON model_versions(user_id, model_type);
CREATE INDEX IF NOT EXISTS idx_model_versions_active
    ON model_versions(user_id, model_type, is_active);
"""

# Joins expense SMS → matches → purchase details → categories into one queryable surface.
# Category totals should use final_category; item amounts use total_cost_rwf;
# transaction totals use sms_transactions.amount_rwf directly.
_SCHEMA_VIEWS = """
DROP VIEW IF EXISTS expense_records_view;
CREATE VIEW expense_records_view AS
SELECT
    st.user_id,
    st.transaction_time,
    st.transaction_type,
    st.amount_rwf,
    st.to_who,
    pd.id              AS purchase_detail_id,
    pd.item_name,
    pd.normalized_item_name,
    pd.quantity,
    pd.unit,
    pd.unit_cost_rwf,
    pd.total_cost_rwf,
    pd.merchant_name,
    ec.predicted_category,
    ec.final_category,
    ec.confidence      AS category_confidence,
    tpm.match_status,
    pd.source_type
FROM sms_transactions st
LEFT JOIN transaction_purchase_matches tpm
    ON tpm.sms_transaction_id = st.id
LEFT JOIN purchase_details pd
    ON pd.id = tpm.purchase_detail_id
LEFT JOIN expense_categories ec
    ON ec.purchase_detail_id = pd.id
WHERE st.transaction_type = 'expense';
"""


def _run_migrations(conn) -> None:
    """
    Safely add new columns to tables that may have been created before the
    current schema.  This replaces Alembic for the simple ALTER TABLE cases.
    """

    def _has_column(table: str, column: str) -> bool:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()  # noqa: S608
        return any(row["name"] == column for row in rows)

    if not _has_column("users", "last_sms_import_at"):
        conn.execute("ALTER TABLE users ADD COLUMN last_sms_import_at TEXT")
        logger.info("Migration: added users.last_sms_import_at")

    if not _has_column("sms_transactions", "provider"):
        conn.execute("ALTER TABLE sms_transactions ADD COLUMN provider TEXT")
        logger.info("Migration: added sms_transactions.provider")

    if not _has_column("sms_transactions", "currency"):
        conn.execute(
            "ALTER TABLE sms_transactions ADD COLUMN currency TEXT DEFAULT 'RWF'"
        )
        logger.info("Migration: added sms_transactions.currency")

    # receipt_uploads: receipt-level OCR metadata + match state
    _receipt_cols = [
        ("merchant_name",    "TEXT"),
        ("total_amount_rwf", "REAL"),
        ("receipt_timestamp","TEXT"),
        ("matched_sms_id",   "INTEGER"),
        ("match_confidence", "REAL"),
        ("match_status",     "TEXT DEFAULT 'unmatched'"),
    ]
    for col, defn in _receipt_cols:
        if not _has_column("receipt_uploads", col):
            conn.execute(f"ALTER TABLE receipt_uploads ADD COLUMN {col} {defn}")  # noqa: S608
            logger.info("Migration: added receipt_uploads.%s", col)


@contextmanager
def get_db():
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


def init_db() -> None:
    """Create all tables, indexes, views, and run incremental column migrations."""
    with get_db() as conn:
        conn.executescript(_SCHEMA_TABLES)
        conn.executescript(_SCHEMA_INDEXES)
        conn.executescript(_SCHEMA_VIEWS)
        _run_migrations(conn)
    logger.info("Database initialised at '%s'.", settings.database_path)
