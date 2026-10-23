"""Errors with a contract code: every non-2xx response is {"error": {"code", "message"}}."""
from __future__ import annotations


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class UpstreamError(Exception):
    """OpenAI refused or timed out."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status
