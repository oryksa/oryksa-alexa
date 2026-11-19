"""ORYKSA public API client for Alexa skills.

Only the standard library, so it runs on an Alexa-hosted Lambda with nothing to
install. The secret key never leaves the Lambda: it mints a short-lived client
token per customer.

Docs: https://developer.oryksa.com
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

VERSION = "1.2.82"
DEFAULT_BASE = "https://api.oryksa.com/v1"
SDK_HEADER = "alexa-python/" + VERSION

# urllib introduces itself as "Python-urllib/3.x", which the edge in front of the
# API blocks outright (Cloudflare 1010), so every request says who it really is.
USER_AGENT = "oryksa-alexa/" + VERSION + " (+https://developer.oryksa.com)"

# Alexa's own locales only. Alexa has no pt-PT, so Portuguese is pt-BR.
SUPPORTED_LOCALES = (
    "en-US", "en-GB", "en-AU", "en-CA", "en-IN",
    "es-ES", "es-MX", "es-US",
    "pt-BR",
)

_CONV_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def http_open(request: Any, timeout: float, opener: Any = None):
    """Send one request. The module-level function is urlopen; only an opener
    object built with build_opener has .open, which is the seam the tests use."""
    if opener is not None:
        return opener.open(request, timeout=timeout)
    return urllib.request.urlopen(request, timeout=timeout)


class OryksaError(Exception):
    """An error the ORYKSA API returned."""

    def __init__(self, status: int, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra


def lang_of(locale: Optional[str]) -> str:
    """The language the API expects (pt | br | en | es) from an Alexa locale."""
    low = (locale or "en-US").lower()
    if low.startswith("pt"):
        return "br"
    if low.startswith("es"):
        return "es"
    return "en"


def conversation_id_for(user_id: Optional[str], prefix: str = "alexa") -> str:
    """A conversation id the server accepts, stable for the same Alexa user.

    conversation_id must match [A-Za-z0-9_-]{1,64} on the server and the Alexa
    userId has dots in it, so it is hashed. The same Echo user therefore keeps
    the same ORYKSA conversation across sessions.
    """
    digest = hashlib.sha256(str(user_id or "anon").encode("utf-8")).hexdigest()
    out = (prefix + "-" + digest)[:64]
    assert _CONV_RE.match(out), out
    return out


class OryksaApi:
    """Talks to api.oryksa.com. One instance can be reused across invocations."""

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE,
        timeout: float = 20.0,
        opener: Any = None,
    ) -> None:
        if not api_key or not str(api_key).startswith("oryk_live_"):
            raise ValueError(
                "An ORYKSA API key (oryk_live_...) is required. Create one at developer.oryksa.com."
            )
        self._key = api_key
        self._base = (base_url or DEFAULT_BASE).rstrip("/")
        self._timeout = timeout
        # A seam for the tests: anything with .open(request, timeout=...)
        self._opener = opener

    # ------------------------------------------------------------------ http

    def _request(self, token: str, method: str, path: str, body: Optional[dict] = None):
        data = None
        headers = {
            "Authorization": "Bearer " + token,
            "X-ORYKSA-SDK": SDK_HEADER,
            "User-Agent": USER_AGENT,
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self._base + path, data=data, headers=headers, method=method)
        try:
            with http_open(req, self._timeout, self._opener) as res:
                raw = res.read().decode("utf-8", "replace")
                status = getattr(res, "status", None) or res.getcode()
        except urllib.error.HTTPError as e:  # 4xx and 5xx
            raw = e.read().decode("utf-8", "replace") if hasattr(e, "read") else ""
            status = e.code
            parsed = _loads(raw)
            err = (parsed or {}).get("error") or {}
            raise OryksaError(
                status,
                err.get("code") or ("http_%d" % status),
                err.get("message") or ("Request failed with HTTP %d" % status),
            ) from None
        except urllib.error.URLError as e:
            raise OryksaError(0, "network_error", "Could not reach the ORYKSA API: %s" % e.reason) from None
        return status, _loads(raw)

    # --------------------------------------------------------------- endpoints

    def create_session(
        self,
        conversation_id: Optional[str] = None,
        customer_name: Optional[str] = None,
        customer_email: Optional[str] = None,
        customer_phone: Optional[str] = None,
        ttl_minutes: int = 1440,
    ) -> Dict[str, Any]:
        """POST /v1/sessions -> {client_token, conversation_id, expires_at}"""
        _s, data = self._request(self._key, "POST", "/sessions", {
            "conversation_id": conversation_id,
            "customer_name": customer_name,
            "customer_email": customer_email,
            "customer_phone": customer_phone,
            "ttl_minutes": ttl_minutes,
        })
        return data or {}

    def chat(
        self,
        client_token: str,
        message: str,
        lang: Optional[str] = None,
        platform: str = "alexa",
        app_context: Optional[dict] = None,
    ) -> Dict[str, Any]:
        """POST /v1/client/chat -> 200 replied, or 202 still writing."""
        status, data = self._request(client_token, "POST", "/client/chat", {
            "message": message,
            "lang": lang,
            "platform": platform,
            "app_context": app_context,
        })
        out = dict(data or {})
        out["status_code"] = status
        return out

    def messages(self, client_token: str) -> Dict[str, Any]:
        """GET /v1/client/messages -> {messages: [{role, content}]}"""
        _s, data = self._request(client_token, "GET", "/client/messages")
        return data or {}

    def agent(self, client_token: str) -> Dict[str, Any]:
        """GET /v1/client/agent -> name, photo, greeting, suggestions, language."""
        _s, data = self._request(client_token, "GET", "/client/agent")
        return data or {}


def _loads(raw: str):
    try:
        return json.loads(raw) if raw else None
    except Exception:
        return None
