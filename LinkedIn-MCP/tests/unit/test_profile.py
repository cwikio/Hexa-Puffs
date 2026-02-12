"""Unit tests for profile tools."""


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
    """Ensure internal Voyager fields are not leaked to the response."""
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


def test_get_own_profile_success(mock_client):
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
    mock_client.get_user_profile.assert_called_once()
    mock_client.get_profile.assert_called_once_with("my-profile-id")


def test_get_own_profile_no_public_id(mock_client):
    mock_client.get_user_profile.return_value = {"miniProfile": {}}

    from src.tools.profile import handle_get_own_profile

    result = handle_get_own_profile()

    assert result["success"] is False
    assert "public ID" in result["error"]
