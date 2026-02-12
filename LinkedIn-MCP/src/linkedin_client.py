"""
Singleton wrapper around the linkedin-api library.

Authenticates lazily on first use. Caches the client instance for the
lifetime of the process. Session cookies are persisted by linkedin-api
in ~/.linkedin_api/cookies/.
"""

import logging
import os

from linkedin_api import Linkedin

logger = logging.getLogger("linkedin")

_client: Linkedin | None = None


def get_client() -> Linkedin:
    """Return (or create) the singleton LinkedIn client."""
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
    _client = Linkedin(email, password)
    logger.info("LinkedIn authentication successful")
    return _client


def reset_client() -> None:
    """Reset the singleton (useful for tests)."""
    global _client
    _client = None
