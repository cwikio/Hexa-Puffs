"""
Singleton wrapper around the linkedin-api library.

Authenticates lazily on first use. Caches the client instance for the
lifetime of the process. Session cookies are persisted by linkedin-api
in ~/.linkedin_api/cookies/.

IMPORTANT: The library loads cached cookies without verifying they're
still valid. We validate the session by calling /me and checking for
error responses. If stale, we delete the cookie file and retry.
"""

import logging
import os
from pathlib import Path

from linkedin_api import Linkedin

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


def get_client() -> Linkedin:
    """Return (or create) the singleton LinkedIn client.

    Validates the session after construction. If stale cookies are
    detected, deletes them and forces a fresh login.
    """
    global _client
    if _client is not None:
        return _client

    email = os.environ.get("LINKEDIN_EMAIL")
    password = os.environ.get("LINKEDIN_PASSWORD")

    if not email or not password:
        raise RuntimeError(
            "LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set"
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
