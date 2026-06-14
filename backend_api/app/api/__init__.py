from fastapi import APIRouter

from app.api import analytics, auth, models, receipts, transactions

router = APIRouter()

router.include_router(
    auth.router,
    prefix="/auth",
    tags=["Authentication"],
)
router.include_router(
    transactions.router,
    prefix="/transactions",
    tags=["Transactions"],
)
router.include_router(
    models.router,
    prefix="/models",
    tags=["Models"],
)
router.include_router(
    receipts.router,
    prefix="/receipts",
    tags=["Receipts"],
)
router.include_router(
    analytics.router,
    prefix="/analytics",
    tags=["Analytics"],
)
