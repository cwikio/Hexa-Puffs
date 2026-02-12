"""Unit tests for search tools."""


def test_search_people_returns_results(mock_client):
    mock_client.search_people.return_value = [
        {
            "public_id": "john-doe",
            "name": "John Doe",
            "headline": "Engineer",
            "location": "NYC",
            "urn_id": "abc123",
        },
        {
            "public_id": "jane-smith",
            "name": "Jane Smith",
            "headline": "Designer",
            "location": "LA",
            "urn_id": "def456",
        },
    ]

    from src.tools.search import handle_search_people

    result = handle_search_people("engineer")

    assert result["success"] is True
    assert result["data"]["count"] == 2
    assert result["data"]["results"][0]["publicId"] == "john-doe"
    assert result["data"]["results"][1]["name"] == "Jane Smith"


def test_search_people_empty_results(mock_client):
    mock_client.search_people.return_value = []

    from src.tools.search import handle_search_people

    result = handle_search_people("nonexistent person xyz")

    assert result["success"] is True
    assert result["data"]["count"] == 0
    assert result["data"]["results"] == []


def test_search_people_respects_limit(mock_client):
    mock_client.search_people.return_value = []

    from src.tools.search import handle_search_people

    handle_search_people("test", limit=5)

    mock_client.search_people.assert_called_once_with(keywords="test", limit=5)


def test_search_people_handles_error(mock_client):
    mock_client.search_people.side_effect = Exception("Rate limited")

    from src.tools.search import handle_search_people

    result = handle_search_people("test")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"
