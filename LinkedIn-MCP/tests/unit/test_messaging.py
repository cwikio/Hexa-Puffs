"""Unit tests for messaging tools."""


def test_get_conversations_returns_threads(mock_client):
    mock_client.get_conversations.return_value = [
        {
            "entityUrn": "urn:li:fs_conversation:123",
            "participants": [
                {
                    "com.linkedin.voyager.messaging.MessagingMember": {
                        "miniProfile": {
                            "firstName": "John",
                            "lastName": "Doe",
                        }
                    }
                }
            ],
            "lastMessage": {
                "body": "Hey, are you free tomorrow?",
                "createdAt": 1700000000000,
            },
            "unreadCount": 1,
        },
    ]

    from src.tools.messaging import handle_get_conversations

    result = handle_get_conversations()

    assert result["success"] is True
    assert result["data"]["count"] == 1
    conv = result["data"]["conversations"][0]
    assert conv["conversationId"] == "123"
    assert conv["participants"] == ["John Doe"]
    assert conv["lastMessage"]["text"] == "Hey, are you free tomorrow?"
    assert conv["unreadCount"] == 1


def test_get_conversations_empty_inbox(mock_client):
    mock_client.get_conversations.return_value = []

    from src.tools.messaging import handle_get_conversations

    result = handle_get_conversations()

    assert result["success"] is True
    assert result["data"]["count"] == 0


def test_get_conversations_respects_limit(mock_client):
    # Return more conversations than the limit
    mock_client.get_conversations.return_value = [
        {
            "entityUrn": f"urn:li:fs_conversation:{i}",
            "participants": [],
            "lastMessage": {"body": f"msg {i}"},
            "unreadCount": 0,
        }
        for i in range(10)
    ]

    from src.tools.messaging import handle_get_conversations

    result = handle_get_conversations(limit=3)

    assert result["success"] is True
    assert result["data"]["count"] == 3


def test_get_conversations_handles_error(mock_client):
    mock_client.get_conversations.side_effect = Exception("Auth expired")

    from src.tools.messaging import handle_get_conversations

    result = handle_get_conversations()

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"
