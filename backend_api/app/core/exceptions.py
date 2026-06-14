from fastapi import Request
from fastapi.responses import JSONResponse


class SmartSpendException(Exception):
    """Base exception for application-level errors."""

    def __init__(self, message: str, status_code: int = 500) -> None:
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class ModelNotAvailableError(SmartSpendException):
    """Raised when a required ML model file is missing or could not be loaded."""

    def __init__(self, model_name: str) -> None:
        super().__init__(
            f"Model '{model_name}' is not available. Trigger a retraining job first.",
            status_code=503,
        )


class InsufficientDataError(SmartSpendException):
    """Raised when there is insufficient data to complete an operation."""

    def __init__(self, message: str = "Insufficient data for this operation.") -> None:
        super().__init__(message, status_code=422)


class ConsentRequiredError(SmartSpendException):
    """Raised when processing personal data without explicit user consent."""

    def __init__(self) -> None:
        super().__init__(
            "User consent must be confirmed before processing personal data.",
            status_code=403,
        )


async def smartspend_exception_handler(
    request: Request, exc: SmartSpendException
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "error_type": type(exc).__name__},
    )
