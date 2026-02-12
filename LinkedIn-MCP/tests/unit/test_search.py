"""Unit tests for search tools."""


# --- search_people ---


def test_search_people_returns_results(mock_client):
    # linkedin-api search_people returns: urn_id, distance, jobtitle, location, name
    mock_client.search_people.return_value = [
        {
            "urn_id": "abc123",
            "name": "John Doe",
            "jobtitle": "Engineer",
            "location": "NYC",
            "distance": "F",
        },
        {
            "urn_id": "def456",
            "name": "Jane Smith",
            "jobtitle": "Designer",
            "location": "LA",
            "distance": "S",
        },
    ]

    from src.tools.search import handle_search_people

    result = handle_search_people("engineer")

    assert result["success"] is True
    assert result["data"]["count"] == 2
    assert result["data"]["results"][0]["urnId"] == "abc123"
    assert result["data"]["results"][0]["name"] == "John Doe"
    assert result["data"]["results"][0]["jobTitle"] == "Engineer"
    assert result["data"]["results"][0]["location"] == "NYC"
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


# --- search_companies ---


def test_search_companies_returns_results(mock_client):
    # linkedin-api search_companies returns: urn_id, name, headline, subline
    mock_client.search_companies.return_value = [
        {
            "name": "Acme Corp",
            "headline": "Building the future",
            "subline": "Technology",
            "urn_id": "comp123",
        },
        {
            "name": "Widget Inc",
            "headline": "Widgets for all",
            "subline": "Manufacturing",
            "urn_id": "comp456",
        },
    ]

    from src.tools.search import handle_search_companies

    result = handle_search_companies("technology")

    assert result["success"] is True
    assert result["data"]["count"] == 2
    assert result["data"]["results"][0]["name"] == "Acme Corp"
    assert result["data"]["results"][0]["headline"] == "Building the future"
    assert result["data"]["results"][0]["urnId"] == "comp123"
    assert result["data"]["results"][1]["name"] == "Widget Inc"


def test_search_companies_empty(mock_client):
    mock_client.search_companies.return_value = []

    from src.tools.search import handle_search_companies

    result = handle_search_companies("nonexistent company xyz")

    assert result["success"] is True
    assert result["data"]["count"] == 0


def test_search_companies_respects_limit(mock_client):
    mock_client.search_companies.return_value = [
        {"name": f"Company {i}", "urn_id": f"c{i}"} for i in range(20)
    ]

    from src.tools.search import handle_search_companies

    result = handle_search_companies("tech", limit=5)

    assert result["data"]["count"] == 5


def test_search_companies_handles_error(mock_client):
    mock_client.search_companies.side_effect = Exception("Rate limited")

    from src.tools.search import handle_search_companies

    result = handle_search_companies("test")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"


# --- get_company ---


def test_get_company_returns_details(mock_client):
    mock_client.get_company.return_value = {
        "name": "Acme Corp",
        "universalName": "acme-corp",
        "description": "We build great things",
        "companyPageUrl": "https://acme.com",
        "companyIndustries": [{"localizedName": "Technology"}],
        "staffCount": 500,
        "headquarter": {"city": "San Francisco", "country": "US"},
        "specialities": ["AI", "ML"],
        "foundedOn": {"year": 2010},
    }

    from src.tools.search import handle_get_company

    result = handle_get_company("acme-corp")

    assert result["success"] is True
    assert result["data"]["name"] == "Acme Corp"
    assert result["data"]["description"] == "We build great things"
    assert result["data"]["website"] == "https://acme.com"
    assert result["data"]["industry"] == "Technology"
    assert result["data"]["staffCount"] == 500
    assert result["data"]["specialities"] == ["AI", "ML"]


def test_get_company_minimal_data(mock_client):
    mock_client.get_company.return_value = {
        "name": "Startup",
        "universalName": "startup",
    }

    from src.tools.search import handle_get_company

    result = handle_get_company("startup")

    assert result["success"] is True
    assert result["data"]["name"] == "Startup"
    assert result["data"]["industry"] == ""
    assert result["data"]["staffCount"] == 0


def test_get_company_handles_error(mock_client):
    mock_client.get_company.side_effect = Exception("Company not found")

    from src.tools.search import handle_get_company

    result = handle_get_company("nonexistent")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"
