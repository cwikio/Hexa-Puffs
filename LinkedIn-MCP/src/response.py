"""
Response helpers matching the TypeScript StandardResponse contract.

Every tool returns one of these shapes so the Orchestrator and Thinker
can parse responses uniformly across Node and Python MCPs.
"""

from typing import Any


def success_response(data: dict[str, Any]) -> dict[str, Any]:
    return {"success": True, "data": data}


def error_response(
    error: str,
    error_code: str = "UNKNOWN_ERROR",
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resp: dict[str, Any] = {"success": False, "error": error, "errorCode": error_code}
    if details:
        resp["errorDetails"] = details
    return resp
