from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, detail: str, field: str | None = None, messages: list[str] | None = None):
        self.status = status
        self.detail = detail
        self.field = field
        self.messages = messages  # several problems for the same field, e.g. zone file lines


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        if exc.messages:
            errors = [{"field": exc.field, "message": m} for m in exc.messages]
        else:
            errors = [{"field": exc.field, "message": exc.detail}] if exc.field else []
        return JSONResponse({"detail": exc.detail, "errors": errors}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        errors = [
            {"field": str(e["loc"][-1]), "message": e["msg"].removeprefix("Value error, ")}
            for e in exc.errors()
        ]
        detail = errors[0]["message"] if errors else "Invalid request."
        return JSONResponse({"detail": detail, "errors": errors}, status_code=422)
