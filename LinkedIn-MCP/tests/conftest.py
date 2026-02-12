"""Shared test fixtures for LinkedIn MCP tests."""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure src is importable
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture
def mock_client():
    """Provide a mocked linkedin-api Linkedin client.

    Patches get_client() so tool handlers use the mock instead of
    authenticating against real LinkedIn.
    """
    with patch("src.linkedin_client.get_client") as mock_get:
        client = MagicMock()
        mock_get.return_value = client
        yield client
