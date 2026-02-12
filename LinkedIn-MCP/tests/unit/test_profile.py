"""Unit tests for profile tools."""

import os
from unittest.mock import patch


def test_get_profile_returns_structured_data(mock_client):
    mock_client.get_profile.return_value = {
        "public_id": "john-doe",
        "firstName": "John",
        "lastName": "Doe",
        "headline": "Engineer at Acme",
        "summary": "I build things.",
        "locationName": "San Francisco",
        "industryName": "Technology",
        "experience": [
            {
                "title": "Senior Engineer",
                "companyName": "Acme Corp",
                "timePeriod": {
                    "startDate": {"year": 2020, "month": 1},
                    "endDate": None,
                },
            }
        ],
        "education": [
            {
                "schoolName": "MIT",
                "degreeName": "BS",
                "fieldOfStudy": "Computer Science",
            }
        ],
    }

    from src.tools.profile import handle_get_profile

    result = handle_get_profile("john-doe")

    assert result["success"] is True
    assert result["data"]["firstName"] == "John"
    assert result["data"]["lastName"] == "Doe"
    assert result["data"]["headline"] == "Engineer at Acme"
    assert result["data"]["location"] == "San Francisco"
    assert len(result["data"]["experience"]) == 1
    assert result["data"]["experience"][0]["company"] == "Acme Corp"
    assert len(result["data"]["education"]) == 1
    assert result["data"]["education"][0]["school"] == "MIT"


def test_get_profile_handles_error(mock_client):
    mock_client.get_profile.side_effect = Exception("Profile not found")

    from src.tools.profile import handle_get_profile

    result = handle_get_profile("nonexistent")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"
    assert "Profile not found" in result["error"]


def test_get_profile_trims_internal_fields(mock_client):
    mock_client.get_profile.return_value = {
        "public_id": "jane",
        "firstName": "Jane",
        "lastName": "Doe",
        "headline": "CTO",
        "entityUrn": "urn:li:fs_miniProfile:abc",
        "versionTag": "1234",
        "trackingId": "xyz",
        "experience": [],
        "education": [],
    }

    from src.tools.profile import handle_get_profile

    result = handle_get_profile("jane")

    assert result["success"] is True
    assert "entityUrn" not in result["data"]
    assert "trackingId" not in result["data"]
    assert "versionTag" not in result["data"]


# --- get_own_profile ---


def test_get_own_profile_success(mock_client):
    """Standard Voyager response with miniProfile.publicIdentifier."""
    mock_client.get_user_profile.return_value = {
        "miniProfile": {"publicIdentifier": "my-profile-id"}
    }
    mock_client.get_profile.return_value = {
        "public_id": "my-profile-id",
        "firstName": "Annabelle",
        "lastName": "AI",
        "headline": "AI Assistant",
        "experience": [],
        "education": [],
    }

    from src.tools.profile import handle_get_own_profile

    result = handle_get_own_profile()

    assert result["success"] is True
    assert result["data"]["firstName"] == "Annabelle"
    mock_client.get_profile.assert_called_once_with("my-profile-id")


def test_get_own_profile_me_error_retries_without_cache(mock_client):
    """/me returns error, retry with use_cache=False succeeds."""
    mock_client.get_user_profile.side_effect = [
        {"status": 403},  # first call (cached error)
        {"miniProfile": {"publicIdentifier": "retry-id"}},  # retry
    ]
    mock_client.client.metadata = {"me": {"status": 403}}
    mock_client.get_profile.return_value = {
        "firstName": "Test",
        "lastName": "User",
        "experience": [],
        "education": [],
    }

    from src.tools.profile import handle_get_own_profile

    result = handle_get_own_profile()

    assert result["success"] is True
    mock_client.get_profile.assert_called_once_with("retry-id")


def test_get_own_profile_me_error_falls_back_to_env(mock_client):
    """/me keeps failing, falls back to LINKEDIN_PUBLIC_ID env var."""
    mock_client.get_user_profile.return_value = {"status": 403}
    mock_client.client.metadata = {}
    mock_client.get_profile.return_value = {
        "public_id": "env-id",
        "firstName": "Env",
        "lastName": "User",
        "experience": [],
        "education": [],
    }

    from src.tools.profile import handle_get_own_profile

    with patch.dict(os.environ, {"LINKEDIN_PUBLIC_ID": "env-id"}):
        result = handle_get_own_profile()

    assert result["success"] is True
    mock_client.get_profile.assert_called_once_with("env-id")


def test_get_own_profile_no_fallback_returns_error(mock_client):
    """/me fails and no LINKEDIN_PUBLIC_ID set."""
    mock_client.get_user_profile.return_value = {"status": 403}
    mock_client.client.metadata = {}

    from src.tools.profile import handle_get_own_profile

    with patch.dict(os.environ, {}, clear=True):
        result = handle_get_own_profile()

    assert result["success"] is False
    assert "LINKEDIN_PUBLIC_ID" in result["error"]


def test_get_own_profile_flat_response(mock_client):
    mock_client.get_user_profile.return_value = {
        "publicIdentifier": "flat-profile-id",
    }
    mock_client.get_profile.return_value = {
        "firstName": "Test",
        "lastName": "User",
        "experience": [],
        "education": [],
    }

    from src.tools.profile import handle_get_own_profile

    result = handle_get_own_profile()

    assert result["success"] is True
    mock_client.get_profile.assert_called_once_with("flat-profile-id")


# --- _extract_own_urn_id ---


def test_extract_own_urn_id_from_mini_profile():
    from src.tools.profile import _extract_own_urn_id

    me = {"miniProfile": {"entityUrn": "urn:li:fs_miniProfile:ACoAABxyz123"}}
    assert _extract_own_urn_id(me) == "ACoAABxyz123"


def test_extract_own_urn_id_from_flat_entity_urn():
    from src.tools.profile import _extract_own_urn_id

    me = {"entityUrn": "urn:li:member:12345"}
    assert _extract_own_urn_id(me) == "12345"


def test_extract_own_urn_id_from_plain_id():
    from src.tools.profile import _extract_own_urn_id

    me = {"plainId": 42}
    assert _extract_own_urn_id(me) == "42"


def test_extract_own_urn_id_none_when_empty():
    from src.tools.profile import _extract_own_urn_id

    assert _extract_own_urn_id({}) is None
    assert _extract_own_urn_id({"miniProfile": {}}) is None
