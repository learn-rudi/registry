"""Bounded stdlib HTTP transport for speech provider adapters."""

from __future__ import annotations

import json
import socket
from dataclasses import dataclass
from typing import Any
from urllib import error, request

from constants import MAX_PROVIDER_RESPONSE_BYTES
from errors import ToolError


@dataclass(frozen=True)
class HttpResponse:
    body: bytes
    headers: dict[str, str]
    status: int


def http_request(
    *,
    method: str,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any] | None,
    timeout: int,
) -> HttpResponse:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(url, data=body, method=method, headers=headers)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_PROVIDER_RESPONSE_BYTES:
                raise ToolError(
                    "provider_error",
                    "Provider response exceeded the maximum allowed size.",
                    {"max_bytes": MAX_PROVIDER_RESPONSE_BYTES},
                )
            response_body = response.read(MAX_PROVIDER_RESPONSE_BYTES + 1)
            if len(response_body) > MAX_PROVIDER_RESPONSE_BYTES:
                raise ToolError(
                    "provider_error",
                    "Provider response exceeded the maximum allowed size.",
                    {"max_bytes": MAX_PROVIDER_RESPONSE_BYTES},
                )
            return HttpResponse(
                body=response_body,
                headers={key.lower(): value for key, value in response.headers.items()},
                status=response.status,
            )
    except ToolError:
        raise
    except error.HTTPError as exc:
        raise ToolError(
            "provider_error",
            f"Provider request failed with HTTP {exc.code}.",
            {"http_status": exc.code},
        ) from exc
    except (error.URLError, socket.timeout, TimeoutError) as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, (socket.timeout, TimeoutError)):
            raise ToolError("timeout", "Provider request timed out.") from exc
        raise ToolError("provider_error", "Provider request could not be completed.") from exc
