import calendar
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.auth import get_current_user_id
from app.core.database import get_db
from app.core.exceptions import ModelNotAvailableError
from app.schemas.schemas import (
    AnalyticsSummary,
    CategorySummary,
    MonthlySummary,
    PredictionSummary,
    SpendingStatusResponse,
)
from app.services.model_service import PRED_FEATURES, model_service

logger = logging.getLogger(__name__)
router = APIRouter()

# Maps the 10 fixed expense category labels to their PRED_FEATURES key
_CATEGORY_TO_FEATURE: dict[str, str] = {
    "Food & Dining":        "food_dining_to_date",
    "Transport":            "transport_to_date",
    "Groceries":            "groceries_to_date",
    "Communication":        "communication_to_date",
    "Education":            "education_to_date",
    "Utilities":            "utilities_to_date",
    "Health":               "health_to_date",
    "Entertainment":        "entertainment_to_date",
    "Savings & Investments":"savings_investments_to_date",
    "Personal Transfer":    "personal_transfer_to_date",
}



# ─── /analytics/summary ─────────────────────────────────────────────────────────────

@router.get(
    "/summary",
    response_model=AnalyticsSummary,
    summary="Income and expense summary for a date range",
)
def get_summary(
    period_start: Optional[str] = Query(
        default=None,
        description="ISO date string (inclusive). Defaults to first day of current month.",
    ),
    period_end: Optional[str] = Query(
        default=None,
        description="ISO date string (inclusive). Defaults to today.",
    ),
    user_id: str = Depends(get_current_user_id),
) -> AnalyticsSummary:
    """
    Aggregate total income (INCOMING) and total expense (OUTGOING, including fees)
    for the specified date range, with a category-level breakdown.
    """
    today = date.today()
    if not period_start:
        period_start = f"{today.year}-{today.month:02d}-01"
    if not period_end:
        period_end = today.isoformat()

    with get_db() as conn:
        income_row = conn.execute(
            "SELECT COALESCE(SUM(amount_rwf), 0) AS total"
            " FROM transactions"
            " WHERE user_id = ? AND direction = 'INCOMING'"
            " AND timestamp >= ? AND timestamp <= ?",
            (user_id, period_start, period_end),
        ).fetchone()
        total_income = float(income_row["total"])

        expense_row = conn.execute(
            "SELECT COALESCE(SUM(total_amount_rwf), 0) AS total"
            " FROM transactions"
            " WHERE user_id = ? AND direction = 'OUTGOING'"
            " AND timestamp >= ? AND timestamp <= ?",
            (user_id, period_start, period_end),
        ).fetchone()
        total_expense = float(expense_row["total"])

        count_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM transactions"
            " WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?",
            (user_id, period_start, period_end),
        ).fetchone()
        count = int(count_row["cnt"])

        cat_rows = conn.execute(
            "SELECT category, SUM(total_amount_rwf) AS total, COUNT(*) AS cnt"
            " FROM transactions"
            " WHERE user_id = ? AND direction = 'OUTGOING' AND category IS NOT NULL"
            " AND timestamp >= ? AND timestamp <= ?"
            " GROUP BY category ORDER BY total DESC",
            (user_id, period_start, period_end),
        ).fetchall()

    category_breakdown = [
        CategorySummary(
            category=row["category"],
            total_rwf=round(float(row["total"]), 2),
            transaction_count=int(row["cnt"]),
            percentage=round(
                (float(row["total"]) / total_expense * 100) if total_expense > 0 else 0.0,
                2,
            ),
        )
        for row in cat_rows
    ]

    return AnalyticsSummary(
        period_start=period_start,
        period_end=period_end,
        total_income=round(total_income, 2),
        total_expense=round(total_expense, 2),
        net_balance=round(total_income - total_expense, 2),
        overspend=total_expense > total_income,
        transaction_count=count,
        category_breakdown=category_breakdown,
    )



# ─── /analytics/monthly ─────────────────────────────────────────────────────────────

@router.get(
    "/monthly",
    response_model=list[MonthlySummary],
    summary="Monthly income and expense trends",
)
def get_monthly_trends(
    months:  int = Query(default=6, ge=1, le=24, description="Number of past months to return."),
    user_id: str = Depends(get_current_user_id),
) -> list[MonthlySummary]:
    """Return per-month income and expense totals for the last N months."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                strftime('%Y-%m', timestamp)                                           AS period,
                SUM(CASE WHEN direction = 'INCOMING' THEN amount_rwf       ELSE 0 END) AS total_income,
                SUM(CASE WHEN direction = 'OUTGOING' THEN total_amount_rwf  ELSE 0 END) AS total_expense,
                COUNT(*)                                                                AS transaction_count
            FROM transactions
            WHERE user_id = ? AND timestamp IS NOT NULL
            GROUP BY period
            ORDER BY period DESC
            LIMIT ?
            """,
            (user_id, months),
        ).fetchall()

    return [
        MonthlySummary(
            period=row["period"],
            total_income=round(float(row["total_income"]), 2),
            total_expense=round(float(row["total_expense"]), 2),
            net=round(float(row["total_income"]) - float(row["total_expense"]), 2),
            transaction_count=int(row["transaction_count"]),
        )
        for row in rows
    ]



# ─── /analytics/categories ──────────────────────────────────────────────────────────

@router.get(
    "/categories",
    response_model=list[CategorySummary],
    summary="Category-level expense breakdown",
)
def get_category_breakdown(
    from_date: Optional[str] = Query(default=None, description="ISO date string (inclusive)"),
    to_date:   Optional[str] = Query(default=None, description="ISO date string (inclusive)"),
    user_id:   str           = Depends(get_current_user_id),
) -> list[CategorySummary]:
    """Return outgoing expenses grouped by category for the specified date range."""
    conditions: list[str] = ["user_id = ?", "direction = 'OUTGOING'", "category IS NOT NULL"]
    params: list = [user_id]

    if from_date:
        conditions.append("timestamp >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("timestamp <= ?")
        params.append(to_date)

    where = " AND ".join(conditions)

    with get_db() as conn:
        grand_total = float(
            conn.execute(
                f"SELECT COALESCE(SUM(total_amount_rwf), 0) FROM transactions WHERE {where}",
                params,
            ).fetchone()[0]
        )
        rows = conn.execute(
            f"SELECT category, SUM(total_amount_rwf) AS total, COUNT(*) AS cnt"
            f" FROM transactions WHERE {where}"
            f" GROUP BY category ORDER BY total DESC",
            params,
        ).fetchall()

    return [
        CategorySummary(
            category=row["category"],
            total_rwf=round(float(row["total"]), 2),
            transaction_count=int(row["cnt"]),
            percentage=round(
                (float(row["total"]) / grand_total * 100) if grand_total > 0 else 0.0,
                2,
            ),
        )
        for row in rows
    ]


# ─── /analytics/spending-status ───────────────────────────────────────────────

@router.get(
    "/spending-status",
    response_model=SpendingStatusResponse,
    summary="Current month spending status and call to action",
)
def get_spending_status(user_id: str = Depends(get_current_user_id)) -> SpendingStatusResponse:
    """
    Returns a single-call dashboard payload for the current month:

    - Income vs expense totals to date
    - Top spending category
    - Risk level (low / medium / high) based on expense-to-income ratio
    - A human-readable status message and projected month-end call to action
    - ML model prediction (predicted month-end expense, income, and overspend
      risk score) — omitted silently if the model is not yet trained

    Risk thresholds (expense as % of income received):
      - < 60 %  → low
      - 60–85 % → medium
      - > 85 %  → high
    """
    today          = date.today()
    days_in_month  = calendar.monthrange(today.year, today.month)[1]
    days_elapsed   = today.day
    days_remaining = days_in_month - today.day
    period_start   = f"{today.year}-{today.month:02d}-01"
    period_end     = today.isoformat()
    period_label   = today.strftime("%B %Y")   # e.g. "June 2026"

    # ── Fetch current-month totals ────────────────────────────────────────────
    with get_db() as conn:
        income_row = conn.execute(
            "SELECT COALESCE(SUM(amount_rwf), 0) AS total FROM transactions"
            " WHERE user_id = ? AND direction = 'INCOMING'"
            " AND timestamp >= ? AND timestamp <= ?",
            (user_id, period_start, period_end),
        ).fetchone()
        total_income = float(income_row["total"])

        expense_row = conn.execute(
            "SELECT COALESCE(SUM(total_amount_rwf), 0) AS total FROM transactions"
            " WHERE user_id = ? AND direction = 'OUTGOING'"
            " AND timestamp >= ? AND timestamp <= ?",
            (user_id, period_start, period_end),
        ).fetchone()
        total_expense = float(expense_row["total"])

        cat_rows = conn.execute(
            "SELECT category, SUM(total_amount_rwf) AS total FROM transactions"
            " WHERE user_id = ? AND direction = 'OUTGOING' AND category IS NOT NULL"
            " AND timestamp >= ? AND timestamp <= ?"
            " GROUP BY category ORDER BY total DESC",
            (user_id, period_start, period_end),
        ).fetchall()

        # Historical monthly averages from the 3 months prior to current
        hist_row = conn.execute(
            """
            SELECT
                AVG(monthly_income)  AS avg_income,
                AVG(monthly_expense) AS avg_expense
            FROM (
                SELECT
                    strftime('%Y-%m', timestamp) AS period,
                    SUM(CASE WHEN direction = 'INCOMING' THEN amount_rwf      ELSE 0 END) AS monthly_income,
                    SUM(CASE WHEN direction = 'OUTGOING' THEN total_amount_rwf ELSE 0 END) AS monthly_expense
                FROM transactions
                WHERE user_id = ?
                  AND timestamp < ?
                  AND timestamp >= date(?, '-3 months')
                GROUP BY period
            )
            """,
            (user_id, period_start, period_start),
        ).fetchone()
        hist_income_avg  = float(hist_row["avg_income"]  or total_income)
        hist_expense_avg = float(hist_row["avg_expense"] or total_expense)

    # ── Per-category breakdown ────────────────────────────────────────────────
    category_totals: dict[str, float] = {
        row["category"]: float(row["total"]) for row in cat_rows
    }
    top_category        = cat_rows[0]["category"] if cat_rows else None
    top_category_amount = float(cat_rows[0]["total"]) if cat_rows else 0.0
    top_category_pct    = round(
        (top_category_amount / total_expense * 100) if total_expense > 0 else 0.0,
        2,
    )

    # ── No-data guard ─────────────────────────────────────────────────────────
    if total_expense == 0 and total_income == 0:
        return SpendingStatusResponse(
            period=period_label,
            days_elapsed=days_elapsed,
            days_remaining=days_remaining,
            total_income=0.0,
            total_expense=0.0,
            net_balance=0.0,
            expense_rate_pct=0.0,
            projected_month_end_expense=0.0,
            projected_net=0.0,
            top_category=None,
            top_category_amount=0.0,
            top_category_pct=0.0,
            risk_level="no_data",
            status_message="No transactions recorded this month yet.",
            call_to_action="Sync your MoMo SMS to start tracking your spending.",
            prediction=None,
        )

    # ── Derived metrics ───────────────────────────────────────────────────────
    net_balance      = round(total_income - total_expense, 2)
    expense_rate_pct = round(
        (total_expense / total_income * 100) if total_income > 0 else 100.0, 2
    )

    # Linear projection based on current daily burn rate
    daily_rate                  = total_expense / max(days_elapsed, 1)
    projected_month_end_expense = round(total_expense + (daily_rate * days_remaining), 2)
    projected_net               = round(total_income - projected_month_end_expense, 2)

    # ── Risk level ────────────────────────────────────────────────────────────
    if expense_rate_pct < 60:
        risk_level = "low"
    elif expense_rate_pct <= 85:
        risk_level = "medium"
    else:
        risk_level = "high"

    # ── Human-readable messages ───────────────────────────────────────────────
    cat_label = top_category or "various categories"

    if risk_level == "low":
        status_message = (
            f"Spending is on track this month. "
            f"{cat_label} is your highest spending category."
        )
    elif risk_level == "medium":
        status_message = (
            f"Your spending is elevated — {expense_rate_pct:.0f}% of income received. "
            f"{cat_label} accounts for {top_category_pct:.0f}% of your expenses."
        )
    else:
        status_message = (
            f"Overspend risk is high at {expense_rate_pct:.0f}% of income received. "
            f"{cat_label} is your biggest expense this month."
        )

    if projected_net >= 0:
        call_to_action = (
            f"At this rate, you will finish {period_label} "
            f"with {int(projected_net):,} RWF remaining."
        )
    else:
        call_to_action = (
            f"At this rate, you may overspend by "
            f"{int(abs(projected_net)):,} RWF by end of {period_label}. "
            f"Consider reducing {cat_label} spending."
        )

    # ── ML prediction (best-effort, silent on unavailability) ─────────────────
    prediction: Optional[PredictionSummary] = None
    try:
        features = {
            "day_of_month":                today.day,
            "income_received_to_date":     total_income,
            "expense_to_date":             total_expense,
            "historical_monthly_income_avg":  hist_income_avg,
            "historical_monthly_expense_avg": hist_expense_avg,
        }
        for cat_name, feature_key in _CATEGORY_TO_FEATURE.items():
            features[feature_key] = category_totals.get(cat_name, 0.0)

        pred_result = model_service.predict_month_end(user_id, features)
        prediction = PredictionSummary(
            predicted_month_end_expense=pred_result["predicted_month_end_expense"],
            predicted_month_end_income=pred_result["predicted_month_end_income"],
            overspend_risk_score=pred_result["overspend_risk_score"],
        )
    except ModelNotAvailableError:
        pass  # Model not yet trained — omit prediction from response
    except Exception as exc:
        logger.warning("Prediction unavailable for spending-status: %s", exc)

    return SpendingStatusResponse(
        period=period_label,
        days_elapsed=days_elapsed,
        days_remaining=days_remaining,
        total_income=round(total_income, 2),
        total_expense=round(total_expense, 2),
        net_balance=net_balance,
        expense_rate_pct=expense_rate_pct,
        projected_month_end_expense=projected_month_end_expense,
        projected_net=projected_net,
        top_category=top_category,
        top_category_amount=round(top_category_amount, 2),
        top_category_pct=top_category_pct,
        risk_level=risk_level,
        status_message=status_message,
        call_to_action=call_to_action,
        prediction=prediction,
    )
