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
    SpendingStatusResponse,
    UnmatchedExpenseOut,
)
from app.services.model_service import model_service

logger = logging.getLogger(__name__)
router = APIRouter()


# --- /analytics/summary -----------------------------------------------

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
    Total income and categorised expense summary for a date range.
    Income totals come from sms_transactions; category totals from expense_records_view.
    """
    today = date.today()
    if not period_start:
        period_start = f"{today.year}-{today.month:02d}-01"
    if not period_end:
        period_end = today.isoformat()
    
    # Append time to ensure we include all transactions on the end date
    period_end_inclusive = f"{period_end}T23:59:59" if 'T' not in period_end else period_end

    with get_db() as conn:
        income_row = conn.execute(
            "SELECT COALESCE(SUM(amount_rwf), 0) AS total, COUNT(*) AS cnt"
            " FROM sms_transactions"
            " WHERE user_id = ? AND transaction_type = 'income'"
            " AND transaction_time >= ? AND transaction_time <= ?",
            (user_id, period_start, period_end_inclusive),
        ).fetchone()
        total_income = float(income_row["total"])

        expense_row = conn.execute(
            "SELECT COALESCE(SUM(amount_rwf), 0) AS total, COUNT(*) AS cnt"
            " FROM sms_transactions"
            " WHERE user_id = ? AND transaction_type = 'expense'"
            " AND transaction_time >= ? AND transaction_time <= ?",
            (user_id, period_start, period_end_inclusive),
        ).fetchone()
        total_expense = float(expense_row["total"])
        tx_count = int(income_row["cnt"]) + int(expense_row["cnt"])

        # Category breakdown: use item costs when available, otherwise transaction amounts
        # This ensures totals match the expense summary at the top
        cat_rows = conn.execute(
            """
            SELECT COALESCE(ec.final_category, 'Uncategorised') AS category,
                   COALESCE(SUM(
                       CASE 
                           WHEN pd.total_cost_rwf IS NOT NULL THEN pd.total_cost_rwf
                           ELSE st.amount_rwf
                       END
                   ), 0) AS total,
                   COUNT(DISTINCT st.id) AS cnt
            FROM sms_transactions st
            LEFT JOIN transaction_purchase_matches tpm
                ON tpm.sms_transaction_id = st.id AND tpm.match_status NOT IN ('unmatched', 'rejected')
            LEFT JOIN purchase_details pd
                ON pd.id = tpm.purchase_detail_id
            LEFT JOIN expense_categories ec
                ON ec.purchase_detail_id = pd.id
            WHERE st.user_id = ? AND st.transaction_type = 'expense'
              AND st.transaction_time >= ? AND st.transaction_time <= ?
            GROUP BY category
            ORDER BY total DESC
            """,
            (user_id, period_start, period_end_inclusive),
        ).fetchall()

    item_total = sum(float(r["total"]) for r in cat_rows)
    category_breakdown = [
        CategorySummary(
            category=row["category"],
            total_rwf=round(float(row["total"]), 2),
            item_count=int(row["cnt"]),
            percentage=round(
                (float(row["total"]) / item_total * 100) if item_total > 0 else 0.0, 2
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
        transaction_count=tx_count,
        category_breakdown=category_breakdown,
    )


# --- /analytics/monthly -----------------------------------------------

@router.get(
    "/monthly",
    response_model=list[MonthlySummary],
    summary="Monthly income and expense trends",
)
def get_monthly_trends(
    months:  int = Query(default=6, ge=1, le=24),
    user_id: str = Depends(get_current_user_id),
) -> list[MonthlySummary]:
    """Return per-month income/expense totals for the last N months."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                strftime('%Y-%m', transaction_time)                                         AS period,
                SUM(CASE WHEN transaction_type = 'income'  THEN amount_rwf ELSE 0 END)     AS total_income,
                SUM(CASE WHEN transaction_type = 'expense' THEN amount_rwf ELSE 0 END)     AS total_expense,
                COUNT(*)                                                                     AS transaction_count
            FROM sms_transactions
            WHERE user_id = ? AND transaction_time IS NOT NULL
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


# --- /analytics/categories --------------------------------------------

@router.get(
    "/categories",
    response_model=list[CategorySummary],
    summary="Expense breakdown by category (all expenses included)",
)
def get_category_breakdown(
    from_date: Optional[str] = Query(default=None),
    to_date:   Optional[str] = Query(default=None),
    user_id:   str           = Depends(get_current_user_id),
) -> list[CategorySummary]:
    """
    Expense totals grouped by final_category.
    For matched expenses, uses item-level costs.
    For unmatched expenses, uses transaction amounts.
    This ensures category totals match transaction-level expense totals.
    """
    conditions = ["st.user_id = ?", "st.transaction_type = 'expense'"]
    params: list = [user_id]

    if from_date:
        conditions.append("st.transaction_time >= ?")
        params.append(from_date)
    if to_date:
        # Append time to ensure we include all transactions on the end date
        to_date_inclusive = f"{to_date}T23:59:59" if 'T' not in to_date else to_date
        conditions.append("st.transaction_time <= ?")
        params.append(to_date_inclusive)

    where = " AND ".join(conditions)

    with get_db() as conn:
        # Calculate grand total from all expense transactions
        grand_total = float(
            conn.execute(
                f"SELECT COALESCE(SUM(amount_rwf), 0) FROM sms_transactions st WHERE {where}",
                params,
            ).fetchone()[0]
        )
        
        # Category breakdown: use item costs when available, transaction amounts otherwise
        rows = conn.execute(
            f"""
            SELECT COALESCE(ec.final_category, 'Uncategorised') AS category,
                   COALESCE(SUM(
                       CASE 
                           WHEN pd.total_cost_rwf IS NOT NULL THEN pd.total_cost_rwf
                           ELSE st.amount_rwf
                       END
                   ), 0) AS total,
                   COUNT(DISTINCT st.id) AS cnt
            FROM sms_transactions st
            LEFT JOIN transaction_purchase_matches tpm
                ON tpm.sms_transaction_id = st.id AND tpm.match_status NOT IN ('unmatched', 'rejected')
            LEFT JOIN purchase_details pd
                ON pd.id = tpm.purchase_detail_id
            LEFT JOIN expense_categories ec
                ON ec.purchase_detail_id = pd.id
            WHERE {where}
            GROUP BY category ORDER BY total DESC
            """,
            params,
        ).fetchall()

    return [
        CategorySummary(
            category=row["category"],
            total_rwf=round(float(row["total"]), 2),
            item_count=int(row["cnt"]),
            percentage=round(
                (float(row["total"]) / grand_total * 100) if grand_total > 0 else 0.0, 2
            ),
        )
        for row in rows
    ]


# --- /analytics/spending-status ---------------------------------------

@router.get(
    "/spending-status",
    response_model=SpendingStatusResponse,
    summary="Current month spending status dashboard",
)
def get_spending_status(user_id: str = Depends(get_current_user_id)) -> SpendingStatusResponse:
    """
    Single-call dashboard payload for the current month:
    - Income vs expense totals to date
    - Top spending category (by item-level cost)
    - Risk level: low / medium / high
    - ML-predicted month-end expense and income (omitted silently if model unavailable)
    - Count of unmatched expense transactions pending clarification

    Risk thresholds (expense as % of income):
      < 60%   -> low
      60-85%  -> medium
      > 85%   -> high
    """
    today          = date.today()
    days_in_month  = calendar.monthrange(today.year, today.month)[1]
    days_elapsed   = today.day
    days_remaining = days_in_month - today.day
    period_start   = f"{today.year}-{today.month:02d}-01"
    period_end     = today.isoformat()
    period_label   = today.strftime("%B %Y")

    with get_db() as conn:
        income_row = conn.execute(
            "SELECT COALESCE(SUM(amount_rwf), 0) AS total FROM sms_transactions"
            " WHERE user_id = ? AND transaction_type = 'income'"
            " AND transaction_time >= ? AND transaction_time <= ?",
            (user_id, period_start, period_end),
        ).fetchone()
        total_income = float(income_row["total"])

        expense_row = conn.execute(
            "SELECT COALESCE(SUM(amount_rwf), 0) AS total FROM sms_transactions"
            " WHERE user_id = ? AND transaction_type = 'expense'"
            " AND transaction_time >= ? AND transaction_time <= ?",
            (user_id, period_start, period_end),
        ).fetchone()
        total_expense = float(expense_row["total"])

        # Category totals: use item costs when available, otherwise transaction amounts
        cat_rows = conn.execute(
            """
            SELECT COALESCE(ec.final_category, 'Uncategorised') AS category,
                   COALESCE(SUM(
                       CASE 
                           WHEN pd.total_cost_rwf IS NOT NULL THEN pd.total_cost_rwf
                           ELSE st.amount_rwf
                       END
                   ), 0) AS total
            FROM sms_transactions st
            LEFT JOIN transaction_purchase_matches tpm
                ON tpm.sms_transaction_id = st.id AND tpm.match_status NOT IN ('unmatched', 'rejected')
            LEFT JOIN purchase_details pd
                ON pd.id = tpm.purchase_detail_id
            LEFT JOIN expense_categories ec
                ON ec.purchase_detail_id = pd.id
            WHERE st.user_id = ? AND st.transaction_type = 'expense'
              AND st.transaction_time >= ? AND st.transaction_time <= ?
            GROUP BY category ORDER BY total DESC
            """,
            (user_id, period_start, period_end),
        ).fetchall()

        # Historical 3-month averages
        hist_row = conn.execute(
            """
            SELECT AVG(mi) AS avg_income, AVG(me) AS avg_expense FROM (
                SELECT
                    strftime('%Y-%m', transaction_time) AS period,
                    SUM(CASE WHEN transaction_type='income'  THEN amount_rwf ELSE 0 END) AS mi,
                    SUM(CASE WHEN transaction_type='expense' THEN amount_rwf ELSE 0 END) AS me
                FROM sms_transactions
                WHERE user_id = ?
                  AND transaction_time < ?
                  AND transaction_time >= date(?, '-3 months')
                GROUP BY period
            )
            """,
            (user_id, period_start, period_start),
        ).fetchone()
        hist_income_avg  = float(hist_row["avg_income"]  or total_income)
        hist_expense_avg = float(hist_row["avg_expense"] or total_expense)

        unmatched_count = conn.execute(
            """
            SELECT COUNT(*) FROM sms_transactions st
            WHERE st.user_id = ? AND st.transaction_type = 'expense'
              AND NOT EXISTS (
                  SELECT 1 FROM transaction_purchase_matches tpm
                  WHERE tpm.sms_transaction_id = st.id
                    AND tpm.match_status NOT IN ('unmatched', 'rejected')
              )
            """,
            (user_id,),
        ).fetchone()[0]

    top_category        = cat_rows[0]["category"] if cat_rows else None
    top_category_amount = float(cat_rows[0]["total"]) if cat_rows else 0.0
    item_total          = sum(float(r["total"]) for r in cat_rows)
    top_category_pct    = round(
        (top_category_amount / item_total * 100) if item_total > 0 else 0.0, 2
    )

    if total_expense == 0 and total_income == 0:
        return SpendingStatusResponse(
            period=period_label,
            days_elapsed=days_elapsed,
            days_remaining=days_remaining,
            total_income=0.0, total_expense=0.0, net_balance=0.0,
            expense_rate_pct=0.0, projected_month_end_expense=0.0, projected_net=0.0,
            top_category=None, top_category_amount=0.0, top_category_pct=0.0,
            risk_level="no_data",
            status_message="No transactions recorded this month yet.",
            call_to_action="Sync your MoMo SMS to start tracking your spending.",
            unmatched_expense_count=int(unmatched_count),
        )

    net_balance      = round(total_income - total_expense, 2)
    expense_rate_pct = round(
        (total_expense / total_income * 100) if total_income > 0 else 100.0, 2
    )
    daily_rate                  = total_expense / max(days_elapsed, 1)
    projected_month_end_expense = round(total_expense + (daily_rate * days_remaining), 2)
    projected_net               = round(total_income - projected_month_end_expense, 2)

    # Initial risk assessment based on current spending rate
    if expense_rate_pct < 60:
        risk_level = "low"
    elif expense_rate_pct <= 85:
        risk_level = "medium"
    else:
        risk_level = "high"

    status_messages = {
        "low":    f"You've spent {expense_rate_pct:.0f}% of your income so far this month.",
        "medium": f"You've spent {expense_rate_pct:.0f}% of your income - watch your spending.",
        "high":   f"You've spent {expense_rate_pct:.0f}% of your income - overspending risk.",
    }
    cta_messages = {
        "low":    "Keep tracking your expenses to stay on budget.",
        "medium": f"Largest spend: {top_category}. Consider reducing it." if top_category else "Review your spending.",
        "high":   "You may overspend by month-end. Cut non-essential expenses now.",
    }

    # Build a category lookup from the item-level cat_rows for the 15-feature dict
    cat_lookup = {r["category"]: float(r["total"]) for r in cat_rows}

    forecast_features = {
        "day_of_month":                    days_elapsed,
        "income_received_to_date":         total_income,
        "expense_to_date":                 total_expense,
        "historical_monthly_income_avg":   hist_income_avg,
        "historical_monthly_expense_avg":  hist_expense_avg,
        "food_dining_to_date":             cat_lookup.get("Food & Dining", 0.0),
        "transport_to_date":               cat_lookup.get("Transport", 0.0),
        "groceries_to_date":               cat_lookup.get("Groceries", 0.0),
        "communication_to_date":           cat_lookup.get("Communication", 0.0),
        "education_to_date":               cat_lookup.get("Education", 0.0),
        "utilities_to_date":               cat_lookup.get("Utilities", 0.0),
        "health_to_date":                  cat_lookup.get("Health", 0.0),
        "entertainment_to_date":           cat_lookup.get("Entertainment", 0.0),
        "savings_investments_to_date":     cat_lookup.get("Savings & Investments", 0.0),
        "personal_transfer_to_date":       cat_lookup.get("Personal Transfer", 0.0),
    }

    # ML predictions (silent fallback)
    predicted_expense: Optional[float] = None
    predicted_income:  Optional[float] = None
    
    try:
        exp_result = model_service.forecast_expense(user_id, forecast_features)
        predicted_expense = exp_result["predicted_month_end_expense"]
    except (ModelNotAvailableError, Exception):
        pass

    try:
        inc_result = model_service.forecast_income(user_id, forecast_features)
        predicted_income = inc_result["predicted_month_end_income"]
    except (ModelNotAvailableError, Exception):
        pass

    # If ML predictions are available, use them for projected balance
    # Otherwise use linear projection based on current spending rate
    final_projected_net = projected_net
    if predicted_expense is not None and predicted_income is not None:
        # ML forecast: predicted values are month-end totals
        ml_projected_net = round(predicted_income - predicted_expense, 2)
        final_projected_net = ml_projected_net
        
        # Adjust risk level if ML forecast contradicts current assessment
        if ml_projected_net < 0 and risk_level == "low":
            risk_level = "medium"
            status_messages["medium"] = f"You've spent {expense_rate_pct:.0f}% so far, but ML forecast predicts overspending by month-end."

    return SpendingStatusResponse(
        period=period_label,
        days_elapsed=days_elapsed,
        days_remaining=days_remaining,
        total_income=round(total_income, 2),
        total_expense=round(total_expense, 2),
        net_balance=net_balance,
        expense_rate_pct=expense_rate_pct,
        projected_month_end_expense=projected_month_end_expense,
        projected_net=final_projected_net,
        top_category=top_category,
        top_category_amount=round(top_category_amount, 2),
        top_category_pct=top_category_pct,
        risk_level=risk_level,
        status_message=status_messages[risk_level],
        call_to_action=cta_messages[risk_level],
        predicted_month_end_expense=predicted_expense,
        predicted_month_end_income=predicted_income,
        unmatched_expense_count=int(unmatched_count),
    )


# ─── /analytics/unmatched-expenses ─────────────────────────────────────────────

@router.get(
    "/unmatched-expenses",
    response_model=list[UnmatchedExpenseOut],
    summary="List expense transactions without purchase details",
)
def get_unmatched_expenses(
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """
    Return all expense SMS transactions that have not been linked to purchase details.
    These are expenses where the user needs to identify what was purchased.
    """
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT st.id, st.amount_rwf, st.to_who, st.transaction_time
            FROM sms_transactions st
            WHERE st.user_id = ? AND st.transaction_type = 'expense'
              AND NOT EXISTS (
                  SELECT 1 FROM transaction_purchase_matches tpm
                  WHERE tpm.sms_transaction_id = st.id
                    AND tpm.match_status NOT IN ('unmatched', 'rejected')
              )
            ORDER BY st.transaction_time DESC
            LIMIT 100
            """,
            (user_id,),
        ).fetchall()
    
    result = []
    for row in rows:
        amount = row["amount_rwf"]
        to_who = row["to_who"] or "someone"
        tx_time = (row["transaction_time"] or "")[:16].replace("T", " ")
        
        clarification_prompt = (
            f"You sent {int(amount):,} RWF to {to_who}"
            + (f" at {tx_time}" if tx_time else "")
            + ". What were you paying for?"
        )
        
        result.append({
            "sms_transaction_id": row["id"],
            "amount_rwf": float(amount),
            "to_who": row["to_who"],
            "transaction_time": row["transaction_time"],
            "clarification_prompt": clarification_prompt,
        })
    
    return result


# ─── /analytics/daily-trends ───────────────────────────────────────────────────

@router.get(
    "/daily-trends",
    response_model=list[dict],
    summary="Daily income and expense totals for the last N days",
)
def get_daily_trends(
    days: int = Query(default=30, ge=1, le=90, description="Number of past days to return."),
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """
    Return per-day income and expense totals for the last N days.
    Useful for daily spending trend visualization.
    """
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                DATE(transaction_time) AS date,
                SUM(CASE WHEN transaction_type = 'income' THEN amount_rwf ELSE 0 END) AS total_income,
                SUM(CASE WHEN transaction_type = 'expense' THEN amount_rwf ELSE 0 END) AS total_expense,
                COUNT(*) AS transaction_count
            FROM sms_transactions
            WHERE user_id = ? 
              AND transaction_time IS NOT NULL
              AND DATE(transaction_time) >= DATE('now', '-' || ? || ' days')
            GROUP BY DATE(transaction_time)
            ORDER BY date DESC
            LIMIT ?
            """,
            (user_id, days, days),
        ).fetchall()
    
    return [
        {
            "date": row["date"],
            "total_income": round(float(row["total_income"]), 2),
            "total_expense": round(float(row["total_expense"]), 2),
            "net": round(float(row["total_income"]) - float(row["total_expense"]), 2),
            "transaction_count": int(row["transaction_count"]),
        }
        for row in rows
    ]

