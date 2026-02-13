"""
Singleton wrapper around the linkedin-api library.

Supports two authentication modes:
1. Browser cookies (preferred) — set LINKEDIN_COOKIES_LI_AT and
   LINKEDIN_COOKIES_JSESSIONID env vars with values from your browser.
   This gives full API access since LinkedIn sees a real browser session.
2. Email/password login — set LINKEDIN_EMAIL and LINKEDIN_PASSWORD.
   Uses the library's Android-based login flow which LinkedIn may restrict.

Session is validated on first use by calling /me. If stale cookies are
detected, they're deleted and a fresh login is attempted.
"""

import logging
import os
from pathlib import Path

from linkedin_api import Linkedin
from linkedin_api.client import Client
from requests.cookies import RequestsCookieJar

logger = logging.getLogger("linkedin")

_client: Linkedin | None = None


def _cookie_path(email: str) -> Path:
    """Return the cookie file path for a given email."""
    return Path.home() / ".linkedin_api" / "cookies" / f"{email}.jr"


def _is_session_valid(client: Linkedin) -> bool:
    """Check if the current session is valid by calling /me."""
    try:
        me = client.get_user_profile()
        if isinstance(me, dict) and "status" in me and "miniProfile" not in me:
            logger.warning("/me returned error status %s — session invalid", me.get("status"))
            return False
        return True
    except Exception as e:
        logger.warning("Session validation failed: %s", e)
        return False


def _create_client_with_cookies(li_at: str, jsessionid: str) -> Linkedin:
    """Create a Linkedin client using browser cookies.

    Bypasses the library's _fetch_metadata() which causes redirect loops
    when mixing browser cookies with Android auth headers.
    """
    # Build cookie jar
    jar = RequestsCookieJar()
    jar.set("li_at", li_at, domain=".linkedin.com", path="/")
    jar.set("JSESSIONID", jsessionid, domain=".linkedin.com", path="/")

    # Create the low-level Client without authentication
    raw_client = Client()
    raw_client._set_session_cookies(jar)
    # Skip _fetch_metadata — it uses Android headers which cause redirect loops

    # Build the Linkedin instance manually, attaching the pre-configured client
    instance = object.__new__(Linkedin)
    instance.client = raw_client
    instance.logger = logger

    return instance


def get_client() -> Linkedin:
    """Return (or create) the singleton LinkedIn client.

    Prefers browser cookies (LINKEDIN_COOKIES_LI_AT) over email/password.
    Validates the session after construction.
    """
    global _client
    if _client is not None:
        return _client

    li_at = os.environ.get("LINKEDIN_COOKIES_LI_AT", "").strip()
    jsessionid = os.environ.get("LINKEDIN_COOKIES_JSESSIONID", "").strip()

    if li_at and jsessionid:
        # Browser cookie mode — full API access
        logger.info("Authenticating with browser cookies (li_at)...")
        client = _create_client_with_cookies(li_at, jsessionid)
        if _is_session_valid(client):
            logger.info("Browser cookie authentication successful")
            _client = client
            return _client
        else:
            logger.error(
                "Browser cookies are invalid or expired. "
                "Re-export li_at and JSESSIONID from your browser."
            )
            # Fall through to email/password if available

    email = os.environ.get("LINKEDIN_EMAIL", "").strip()
    password = os.environ.get("LINKEDIN_PASSWORD", "").strip()

    if not email or not password:
        if li_at:
            raise RuntimeError(
                "Browser cookies are expired and no LINKEDIN_EMAIL/PASSWORD fallback set"
            )
        raise RuntimeError(
            "Set LINKEDIN_COOKIES_LI_AT + LINKEDIN_COOKIES_JSESSIONID (preferred) "
            "or LINKEDIN_EMAIL + LINKEDIN_PASSWORD"
        )

    logger.info("Authenticating with LinkedIn as %s ...", email)
    client = Linkedin(email, password)

    # Validate session — library loads cached cookies without checking
    if not _is_session_valid(client):
        cookie_file = _cookie_path(email)
        if cookie_file.exists():
            logger.warning("Deleting stale cookies at %s and re-authenticating...", cookie_file)
            cookie_file.unlink()
            client = Linkedin(email, password)
            if not _is_session_valid(client):
                logger.error("Fresh authentication also returned invalid session")
            else:
                logger.info("Re-authentication successful after cookie reset")
        else:
            logger.error("Session invalid but no cookie file to delete")

    _client = client
    logger.info("LinkedIn authentication complete")
    return _client


def reset_client() -> None:
    """Reset the singleton (useful for tests)."""
    global _client
    _client = None
