"""Unit tests for network tools."""


# --- get_connections ---


def test_get_connections_returns_list(mock_client):
    mock_client.get_user_profile.return_value = {
        "miniProfile": {"entityUrn": "urn:li:fs_miniProfile:abc123"}
    }
    mock_client.get_profile_connections.return_value = [
        {
            "public_id": "john-doe",
            "firstName": "John",
            "lastName": "Doe",
            "headline": "Engineer at Acme",
            "urn_id": "urn1",
        },
        {
            "public_id": "jane-smith",
            "firstName": "Jane",
            "lastName": "Smith",
            "headline": "Designer",
            "urn_id": "urn2",
        },
    ]

    from src.tools.network import handle_get_connections

    result = handle_get_connections()

    assert result["success"] is True
    assert result["data"]["count"] == 2
    assert result["data"]["connections"][0]["publicId"] == "john-doe"
    assert result["data"]["connections"][0]["name"] == "John Doe"
    assert result["data"]["connections"][1]["name"] == "Jane Smith"
    mock_client.get_profile_connections.assert_called_once_with("abc123")


def test_get_connections_respects_limit(mock_client):
    mock_client.get_user_profile.return_value = {
        "miniProfile": {"entityUrn": "urn:li:fs_miniProfile:abc123"}
    }
    mock_client.get_profile_connections.return_value = [
        {"public_id": f"user-{i}", "firstName": f"User", "lastName": f"{i}"}
        for i in range(20)
    ]

    from src.tools.network import handle_get_connections

    result = handle_get_connections(limit=5)

    assert result["data"]["count"] == 5


def test_get_connections_no_urn_id(mock_client):
    mock_client.get_user_profile.return_value = {"miniProfile": {}}

    from src.tools.network import handle_get_connections

    result = handle_get_connections()

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"


def test_get_connections_handles_error(mock_client):
    mock_client.get_user_profile.side_effect = Exception("Auth expired")

    from src.tools.network import handle_get_connections

    result = handle_get_connections()

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"


# --- send_connection_request ---


def test_send_connection_request_success(mock_client):
    from src.tools.network import handle_send_connection_request

    result = handle_send_connection_request("john-doe", message="Let's connect!")

    assert result["success"] is True
    assert result["data"]["sent"] is True
    assert result["data"]["profilePublicId"] == "john-doe"
    mock_client.add_connection.assert_called_once_with("john-doe", message="Let's connect!")


def test_send_connection_request_no_message(mock_client):
    from src.tools.network import handle_send_connection_request

    result = handle_send_connection_request("john-doe")

    assert result["success"] is True
    mock_client.add_connection.assert_called_once_with("john-doe", message="")


def test_send_connection_request_message_too_long(mock_client):
    from src.tools.network import handle_send_connection_request

    result = handle_send_connection_request("john-doe", message="x" * 301)

    assert result["success"] is False
    assert result["errorCode"] == "VALIDATION_ERROR"
    mock_client.add_connection.assert_not_called()


def test_send_connection_request_handles_error(mock_client):
    mock_client.add_connection.side_effect = Exception("Already connected")

    from src.tools.network import handle_send_connection_request

    result = handle_send_connection_request("john-doe")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"
