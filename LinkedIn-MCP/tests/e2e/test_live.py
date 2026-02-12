"""End-to-end tests against real LinkedIn API.

These tests are SKIPPED by default. They only run when LINKEDIN_EMAIL
is set in the environment. Use for manual validation that the
linkedin-api library still works and LinkedIn hasn't broken their
internal API.

Run with:
    LINKEDIN_EMAIL=x LINKEDIN_PASSWORD=y .venv/bin/python -m pytest tests/e2e/ -v
"""

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("LINKEDIN_EMAIL"),
    reason="LINKEDIN_EMAIL not set — skipping live LinkedIn tests",
)


def test_live_authentication():
    """Verify we can authenticate with LinkedIn."""
    from src.linkedin_client import get_client

    client = get_client()
    assert client is not None


def test_live_get_own_profile():
    """Verify we can fetch our own profile."""
    from src.tools.profile import handle_get_own_profile

    result = handle_get_own_profile()
    assert result["success"] is True
    assert result["data"]["firstName"]


def test_live_get_feed():
    """Verify we can read the feed."""
    from src.tools.posts import handle_get_feed_posts

    result = handle_get_feed_posts(limit=3)
    assert result["success"] is True
    assert isinstance(result["data"]["posts"], list)


def test_live_search_people():
    """Verify we can search for people."""
    from src.tools.search import handle_search_people

    result = handle_search_people("software engineer", limit=3)
    assert result["success"] is True
    assert isinstance(result["data"]["results"], list)
