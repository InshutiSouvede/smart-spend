import logging
import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Generator

from app.core.config import settings

logger = logging.getLogger(__name__)

# Try to import PostgreSQL driver (only needed in production)
try:
    import psycopg2
    import psycopg2.extras
    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False
    logger.warning("psycopg2 not installed - PostgreSQL support disabled")


class HybridRow:
    """
    Row wrapper that supports both numeric and named indexing.
    Compatible with both SQLite Row and PostgreSQL RealDictRow.
    """
    def __init__(self, data):
        if isinstance(data, dict):
            # PostgreSQL RealDictRow (is a dict-like object)
            self._dict = dict(data)
            self._keys = list(data.keys())
        elif hasattr(data, 'keys'):
            # SQLite Row or similar
            self._keys = list(data.keys())
            self._dict = {k: data[k] for k in self._keys}
        else:
            # Fallback
            self._dict = {}
            self._keys = []
    
    def __getitem__(self, key):
        """Support both numeric (row[0]) and named (row['column']) indexing."""
        if isinstance(key, int):
            # Numeric indexing
            if 0 <= key < len(self._keys):
                return self._dict[self._keys[key]]
            raise IndexError(f"Row index out of range: {key}")
        else:
            # Named indexing
            return self._dict[key]
    
    def __contains__(self, key):
        return key in self._dict
    
    def keys(self):
        return self._keys
    
    def values(self):
        return [self._dict[k] for k in self._keys]
    
    def items(self):
        return [(k, self._dict[k]) for k in self._keys]
    
    def get(self, key, default=None):
        if isinstance(key, int):
            if 0 <= key < len(self._keys):
                return self._dict[self._keys[key]]
            return default
        return self._dict.get(key, default)


class CursorWrapper:
    """Wrapper for database cursor that converts rows to HybridRow."""
    def __init__(self, cursor, db_type: str):
        self._cursor = cursor
        self._db_type = db_type
        self._lastrowid = None
    
    def fetchone(self):
        """Fetch one row and wrap it."""
        row = self._cursor.fetchone()
        if row is None:
            return None
        return HybridRow(row)
    
    def fetchall(self):
        """Fetch all rows and wrap them."""
        rows = self._cursor.fetchall()
        return [HybridRow(row) for row in rows]
    
    def fetchmany(self, size=None):
        """Fetch many rows and wrap them."""
        if size is None:
            rows = self._cursor.fetchmany()
        else:
            rows = self._cursor.fetchmany(size)
        return [HybridRow(row) for row in rows]
    
    @property
    def lastrowid(self):
        """Return the last inserted row ID (compatible with SQLite and PostgreSQL)."""
        if self._lastrowid is not None:
            return self._lastrowid
        # Fallback to SQLite behavior
        return getattr(self._cursor, 'lastrowid', None)
    
    def _set_lastrowid(self, row_id):
        """Internal method to set lastrowid for PostgreSQL RETURNING."""
        self._lastrowid = row_id
    
    def __getattr__(self, name):
        """Delegate other attributes to the underlying cursor."""
        return getattr(self._cursor, name)


class DatabaseConnection:
    """
    Wrapper class that provides a unified interface for both SQLite and PostgreSQL connections.
    Adds an execute() method to PostgreSQL connections (which only have cursor.execute()).
    """
    def __init__(self, conn, db_type: str):
        self._conn = conn
        self._db_type = db_type
        self._cursor = None
        
    def execute(self, query: str, params: tuple = ()):
        """
        Execute a query and return a cursor-like object.
        Handles both SQLite (which has conn.execute) and PostgreSQL (which needs cursor).
        Automatically converts ? placeholders to %s for PostgreSQL and common SQL patterns.
        For PostgreSQL INSERTs, automatically adds RETURNING id to support lastrowid.
        Returns a CursorWrapper that supports both numeric and named row indexing.
        """
        if self._db_type == 'postgresql':
            # Convert SQLite-specific SQL to PostgreSQL
            query = self._convert_sql_dialect(query)
            # Convert ? to %s for PostgreSQL
            query = query.replace('?', '%s')
            
            # Auto-add RETURNING id for INSERT statements (to support lastrowid)
            is_insert = query.strip().upper().startswith('INSERT')
            has_returning = 'RETURNING' in query.upper()
            
            if is_insert and not has_returning:
                # Add RETURNING id for PostgreSQL to get auto-generated ID
                query = query.rstrip().rstrip(';') + ' RETURNING id'
            
            # For PostgreSQL, create a cursor if needed and execute
            if self._cursor is None:
                self._cursor = self._conn.cursor()
            self._cursor.execute(query, params)
            
            # Create wrapped cursor
            wrapper = CursorWrapper(self._cursor, 'postgresql')
            
            # If INSERT with RETURNING, fetch the returned ID
            if is_insert and 'RETURNING' in query.upper():
                try:
                    result = self._cursor.fetchone()
                    if result and 'id' in result:
                        wrapper._set_lastrowid(result['id'])
                except Exception:
                    pass  # If fetch fails, lastrowid will be None
            
            return wrapper
        else:
            # For SQLite, execute and wrap the cursor
            cursor = self._conn.execute(query, params)
            return CursorWrapper(cursor, 'sqlite')
    
    def _convert_sql_dialect(self, query: str) -> str:
        """Convert SQLite SQL syntax to PostgreSQL."""
        import re
        
        # Convert strftime('%Y-%m', column) to TO_CHAR(column, 'YYYY-MM')
        query = re.sub(
            r"strftime\s*\(\s*'%Y-%m'\s*,\s*(\w+)\s*\)",
            r"TO_CHAR(\1, 'YYYY-MM')",
            query,
            flags=re.IGNORECASE
        )
        
        # Convert strftime('%s', ?) to EXTRACT(EPOCH FROM ?::TIMESTAMP) for parameters
        query = re.sub(
            r"strftime\s*\(\s*'%s'\s*,\s*\?\s*\)",
            r"EXTRACT(EPOCH FROM ?::TIMESTAMP)",
            query,
            flags=re.IGNORECASE
        )
        
        # Convert strftime('%s', column) to EXTRACT(EPOCH FROM column) for columns
        query = re.sub(
            r"strftime\s*\(\s*'%s'\s*,\s*([^)]+)\s*\)",
            r"EXTRACT(EPOCH FROM \1)",
            query,
            flags=re.IGNORECASE
        )
        
        # Convert date(?, '-3 months') to CAST(? AS TIMESTAMP) - INTERVAL '3 months'
        query = re.sub(
            r"date\s*\(\s*\?\s*,\s*'-(\d+)\s+months'\s*\)",
            r"(CAST(? AS TIMESTAMP) - INTERVAL '\1 months')",
            query,
            flags=re.IGNORECASE
        )
        
        # Convert DATE(column) to DATE(column) - this works in both
        # But DATE('now', ...) needs conversion
        # Convert DATE('now', '-' || ? || ' days') to (CURRENT_DATE - (? || ' days')::INTERVAL)
        query = re.sub(
            r"DATE\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*'\s*days'\s*\)",
            r"(CURRENT_DATE - (? || ' days')::INTERVAL)",
            query,
            flags=re.IGNORECASE
        )
        
        # Convert DATE('now') to CURRENT_DATE
        query = re.sub(
            r"DATE\s*\(\s*'now'\s*\)",
            r"CURRENT_DATE",
            query,
            flags=re.IGNORECASE
        )
        
        return query
    
    def cursor(self):
        """Create and return a new cursor."""
        return self._conn.cursor()
    
    def commit(self):
        return self._conn.commit()
    
    def rollback(self):
        return self._conn.rollback()
    
    def close(self):
        if self._cursor:
            self._cursor.close()
        return self._conn.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._cursor:
            self._cursor.close()
        return False


def get_database_type() -> str:
    """Detect database type from environment."""
    database_url = os.getenv('DATABASE_URL', '')
    if database_url.startswith('postgresql://') or database_url.startswith('postgres://'):
        if not HAS_POSTGRES:
            raise RuntimeError(
                "DATABASE_URL points to PostgreSQL but psycopg2 is not installed. "
                "Run: pip install psycopg2-binary"
            )
        return 'postgresql'
    return 'sqlite'


DB_TYPE = get_database_type()
logger.info(f"Database type detected: {DB_TYPE}")


def convert_query_placeholders(query: str, params: tuple) -> tuple:
    """
    Convert query placeholders from ? to %s for PostgreSQL.
    Returns (converted_query, params).
    
    Usage:
        query, params = convert_query_placeholders(
            "SELECT * FROM users WHERE id = ?", 
            (user_id,)
        )
        cursor.execute(query, params)
    """
    if DB_TYPE == 'postgresql':
        # Convert ? to %s for PostgreSQL
        converted_query = query.replace('?', '%s')
        return converted_query, params
    return query, params

# SQLite Schema
_SCHEMA_TABLES_SQLITE = """
CREATE TABLE IF NOT EXISTS users (
    id                 TEXT PRIMARY KEY,
    email              TEXT UNIQUE NOT NULL,
    display_name       TEXT,
    last_sms_import_at TEXT,
    created_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS receipt_uploads (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id               TEXT    NOT NULL,
    file_path             TEXT    NOT NULL,
    ocr_raw_text          TEXT,
    ocr_status            TEXT    DEFAULT 'pending',
    extraction_status     TEXT    DEFAULT 'pending',
    merchant_name         TEXT,
    total_amount_rwf      REAL,
    receipt_timestamp     TEXT,
    matched_sms_id        INTEGER,
    match_confidence      REAL,
    match_status          TEXT    DEFAULT 'unmatched',
    ocr_confidence        REAL,
    validation_warnings   TEXT,
    parser_source         TEXT,
    completeness_score    REAL,
    uploaded_at           TEXT    DEFAULT CURRENT_TIMESTAMP,
    processed_at          TEXT
);

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

CREATE TABLE IF NOT EXISTS custom_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    created_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

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

# PostgreSQL Schema
_SCHEMA_TABLES_POSTGRES = """
CREATE TABLE IF NOT EXISTS users (
    id                 TEXT PRIMARY KEY,
    email              TEXT UNIQUE NOT NULL,
    display_name       TEXT,
    last_sms_import_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_transactions (
    id                    SERIAL PRIMARY KEY,
    user_id               TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_message_id     TEXT,
    sender                TEXT,
    raw_sms_text          TEXT    NOT NULL,
    raw_sms_hash          TEXT    NOT NULL,
    sms_time              TIMESTAMPTZ,
    transaction_time      TIMESTAMPTZ,
    transaction_type      TEXT    NOT NULL CHECK(transaction_type IN ('income', 'expense')),
    amount_rwf            NUMERIC(15,2) NOT NULL,
    fee_rwf               NUMERIC(15,2) NOT NULL DEFAULT 0.0,
    balance_after_rwf     NUMERIC(15,2),
    to_who                TEXT,
    from_who              TEXT,
    transaction_reference TEXT,
    parse_confidence      NUMERIC(3,2) DEFAULT 1.0,
    provider              TEXT,
    currency              TEXT    DEFAULT 'RWF',
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_details (
    id                    SERIAL PRIMARY KEY,
    user_id               TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type           TEXT    NOT NULL CHECK(source_type IN ('receipt', 'user_prompt')),
    source_id             INTEGER NOT NULL,
    purchase_time         TIMESTAMPTZ,
    merchant_name         TEXT,
    item_name             TEXT    NOT NULL,
    normalized_item_name  TEXT,
    quantity              NUMERIC(10,2) DEFAULT 1.0,
    unit                  TEXT,
    unit_cost_rwf         NUMERIC(15,2),
    total_cost_rwf        NUMERIC(15,2) NOT NULL,
    extraction_confidence NUMERIC(3,2) DEFAULT 1.0,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS receipt_uploads (
    id                    SERIAL PRIMARY KEY,
    user_id               TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path             TEXT    NOT NULL,
    ocr_raw_text          TEXT,
    ocr_status            TEXT    DEFAULT 'pending',
    extraction_status     TEXT    DEFAULT 'pending',
    merchant_name         TEXT,
    total_amount_rwf      NUMERIC(15,2),
    receipt_timestamp     TIMESTAMPTZ,
    matched_sms_id        INTEGER REFERENCES sms_transactions(id),
    match_confidence      NUMERIC(3,2),
    match_status          TEXT    DEFAULT 'unmatched',
    ocr_confidence        NUMERIC(3,2),
    validation_warnings   TEXT,
    parser_source         TEXT,
    completeness_score    NUMERIC(3,2),
    uploaded_at           TIMESTAMPTZ DEFAULT NOW(),
    processed_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS transaction_purchase_matches (
    id                   SERIAL PRIMARY KEY,
    user_id              TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sms_transaction_id   INTEGER NOT NULL REFERENCES sms_transactions(id) ON DELETE CASCADE,
    purchase_detail_id   INTEGER NOT NULL REFERENCES purchase_details(id) ON DELETE CASCADE,
    match_status         TEXT    NOT NULL DEFAULT 'auto_matched'
                         CHECK(match_status IN ('auto_matched', 'user_confirmed', 'unmatched', 'rejected')),
    match_score          NUMERIC(3,2),
    matched_by           TEXT    NOT NULL DEFAULT 'system'
                         CHECK(matched_by IN ('system', 'user')),
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_categories (
    id                 SERIAL PRIMARY KEY,
    user_id            TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purchase_detail_id INTEGER NOT NULL UNIQUE REFERENCES purchase_details(id) ON DELETE CASCADE,
    predicted_category TEXT,
    confidence         NUMERIC(3,2),
    final_category     TEXT,
    category_source    TEXT    NOT NULL DEFAULT 'model'
                       CHECK(category_source IN ('model', 'user_correction', 'rule')),
    corrected_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS category_corrections (
    id                   SERIAL PRIMARY KEY,
    user_id              TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purchase_detail_id   INTEGER,
    item_name            TEXT    NOT NULL,
    normalized_item_name TEXT,
    merchant_name        TEXT,
    to_who               TEXT,
    quantity             NUMERIC(10,2),
    unit                 TEXT,
    unit_cost_rwf        NUMERIC(15,2),
    total_cost_rwf       NUMERIC(15,2),
    purchase_month       INTEGER,
    purchase_weekday     INTEGER,
    previous_category    TEXT,
    corrected_category   TEXT    NOT NULL,
    correction_source    TEXT    DEFAULT 'user',
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_categories (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS monthly_financial_aggregates (
    id                         SERIAL PRIMARY KEY,
    user_id                    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year                       INTEGER NOT NULL,
    month                      INTEGER NOT NULL,
    category                   TEXT,
    total_expense_rwf          NUMERIC(15,2) DEFAULT 0.0,
    total_income_rwf           NUMERIC(15,2) DEFAULT 0.0,
    expense_transaction_count  INTEGER DEFAULT 0,
    income_transaction_count   INTEGER DEFAULT 0,
    average_expense_amount_rwf NUMERIC(15,2),
    average_income_amount_rwf  NUMERIC(15,2),
    created_at                 TIMESTAMPTZ DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, year, month, category)
);

CREATE TABLE IF NOT EXISTS retraining_jobs (
    id                  SERIAL PRIMARY KEY,
    user_id             TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    started_at          TIMESTAMPTZ DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    error_message       TEXT
);

CREATE TABLE IF NOT EXISTS model_versions (
    id                  SERIAL PRIMARY KEY,
    user_id             TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    created_at          TIMESTAMPTZ DEFAULT NOW()
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
CREATE INDEX IF NOT EXISTS idx_custom_categories_user
    ON custom_categories(user_id);
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
    current schema. This replaces Alembic for simple ALTER TABLE cases.
    Supports both SQLite and PostgreSQL.
    """
    def _has_column(table: str, column: str) -> bool:
        if DB_TYPE == 'postgresql':
            cursor = conn.cursor()
            cursor.execute("""
                SELECT EXISTS (
                    SELECT 1 
                    FROM information_schema.columns 
                    WHERE table_name = %s AND column_name = %s
                )
            """, (table, column))
            result = cursor.fetchone()
            cursor.close()
            return result[0] if result else False
        else:
            rows = conn.execute(f"PRAGMA table_info({table})").fetchall()  # noqa: S608
            return any(row["name"] == column for row in rows)
    
    def _execute(sql: str) -> None:
        """Execute SQL for current DB type."""
        if DB_TYPE == 'postgresql':
            cursor = conn.cursor()
            cursor.execute(sql)
            cursor.close()
        else:
            conn.execute(sql)

    # Define migrations with DB-specific type mappings
    def _get_type(sqlite_type: str) -> str:
        """Convert SQLite type to appropriate type for current DB."""
        if DB_TYPE == 'sqlite':
            return sqlite_type
        # PostgreSQL type mappings
        type_map = {
            'TEXT': 'TEXT',
            'REAL': 'NUMERIC(15,2)',
            'INTEGER': 'INTEGER',
            'TEXT DEFAULT \'unmatched\'': 'TEXT DEFAULT \'unmatched\'',
            'TEXT DEFAULT \'RWF\'': 'TEXT DEFAULT \'RWF\'',
            'TIMESTAMPTZ': 'TIMESTAMPTZ',
        }
        return type_map.get(sqlite_type, sqlite_type)

    if not _has_column("users", "last_sms_import_at"):
        col_type = 'TIMESTAMPTZ' if DB_TYPE == 'postgresql' else 'TEXT'
        _execute(f"ALTER TABLE users ADD COLUMN last_sms_import_at {col_type}")  # noqa: S608
        logger.info("Migration: added users.last_sms_import_at")

    if not _has_column("sms_transactions", "provider"):
        _execute("ALTER TABLE sms_transactions ADD COLUMN provider TEXT")
        logger.info("Migration: added sms_transactions.provider")

    if not _has_column("sms_transactions", "currency"):
        _execute(
            "ALTER TABLE sms_transactions ADD COLUMN currency TEXT DEFAULT 'RWF'"
        )
        logger.info("Migration: added sms_transactions.currency")

    # receipt_uploads: receipt-level OCR metadata + match state
    _receipt_cols = [
        ("merchant_name",    "TEXT"),
        ("total_amount_rwf", "REAL"),
        ("receipt_timestamp","TEXT" if DB_TYPE == 'sqlite' else "TIMESTAMPTZ"),
        ("matched_sms_id",   "INTEGER"),
        ("match_confidence", "REAL"),
        ("match_status",     "TEXT DEFAULT 'unmatched'"),
    ]
    for col, defn in _receipt_cols:
        if not _has_column("receipt_uploads", col):
            col_type = _get_type(defn)
            _execute(f"ALTER TABLE receipt_uploads ADD COLUMN {col} {col_type}")  # noqa: S608
            logger.info("Migration: added receipt_uploads.%s", col)
    
    # receipt_uploads: Enhanced OCR quality indicators
    _receipt_quality_cols = [
        ("ocr_confidence",      "REAL"),
        ("validation_warnings", "TEXT"),
        ("parser_source",       "TEXT"),
        ("completeness_score",  "REAL"),
    ]
    for col, defn in _receipt_quality_cols:
        if not _has_column("receipt_uploads", col):
            col_type = _get_type(defn)
            _execute(f"ALTER TABLE receipt_uploads ADD COLUMN {col} {col_type}")  # noqa: S608
            logger.info("Migration: added receipt_uploads.%s", col)
    
    # retraining_jobs: Ensure status column exists (critical for job tracking)
    if not _has_column("retraining_jobs", "status"):
        _execute("ALTER TABLE retraining_jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'queued'")  # noqa: S608
        logger.info("Migration: added retraining_jobs.status")


@contextmanager
def get_db() -> Generator[Any, None, None]:
    """
    Universal database connection context manager.
    Auto-detects SQLite vs PostgreSQL from DATABASE_URL env var.
    Returns a DatabaseConnection wrapper that provides a unified interface.
    
    IMPORTANT: For PostgreSQL (Supabase), use direct connection (port 5432), 
    NOT pooling connection (port 6543). Transaction pooling cannot execute 
    DDL statements (CREATE TABLE, ALTER TABLE) needed during initialization.
    """
    if DB_TYPE == 'postgresql':
        database_url = os.getenv('DATABASE_URL', '')
        if not database_url:
            raise ValueError("DATABASE_URL environment variable not set")
        
        # Connection settings optimized for serverless pooling
        raw_conn = psycopg2.connect(
            database_url,
            cursor_factory=psycopg2.extras.RealDictCursor,
            connect_timeout=10  # 10 second timeout
        )
        raw_conn.autocommit = False
        conn = DatabaseConnection(raw_conn, 'postgresql')
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    else:
        # SQLite
        raw_conn = sqlite3.connect(settings.database_path)
        raw_conn.row_factory = sqlite3.Row
        conn = DatabaseConnection(raw_conn, 'sqlite')
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
    try:
        with get_db() as conn:
            if DB_TYPE == 'postgresql':
                # PostgreSQL: Execute statements individually
                cursor = conn.cursor()
                # Step 1: Create tables
                for statement in _SCHEMA_TABLES_POSTGRES.split(';'):
                    statement = statement.strip()
                    if statement:
                        cursor.execute(statement)
                cursor.close()
                
                # Step 2: Run migrations BEFORE creating indexes (indexes may reference new columns)
                _run_migrations(conn)
                
                # Step 3: Create indexes (now that all columns exist)
                cursor = conn.cursor()
                for statement in _SCHEMA_INDEXES.split(';'):
                    statement = statement.strip()
                    if statement:
                        cursor.execute(statement)
                
                # Step 4: Create views
                for statement in _SCHEMA_VIEWS.split(';'):
                    statement = statement.strip()
                    if statement:
                        cursor.execute(statement)
                cursor.close()
                logger.info("PostgreSQL database initialized")
            else:
                # SQLite: Use executescript
                conn.executescript(_SCHEMA_TABLES_SQLITE)
                # Run migrations before indexes (indexes may reference new columns)
                _run_migrations(conn)
                conn.executescript(_SCHEMA_INDEXES)
                conn.executescript(_SCHEMA_VIEWS)
                logger.info("SQLite database initialized at '%s'", settings.database_path)
    except Exception as e:
        logger.error("Failed to initialize database: %s", str(e))
        logger.error("Database type: %s", DB_TYPE)
        if DB_TYPE == 'postgresql':
            logger.error("DATABASE_URL: %s", os.getenv('DATABASE_URL', 'NOT_SET')[:50] + '...')
        raise
