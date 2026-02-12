"""Unit tests for messaging tools."""


# --- get_conversations ---


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


# --- send_message ---


def test_send_message_to_conversation(mock_client):
    from src.tools.messaging import handle_send_message

    result = handle_send_message("Hello!", conversation_urn_id="conv123")

    assert result["success"] is True
    assert result["data"]["sent"] is True
    mock_client.send_message.assert_called_once_with(
        message_body="Hello!",
        conversation_urn_id="conv123",
        recipients=None,
    )


def test_send_message_to_recipients(mock_client):
    from src.tools.messaging import handle_send_message

    result = handle_send_message("Hi there", recipients=["urn1", "urn2"])

    assert result["success"] is True
    mock_client.send_message.assert_called_once_with(
        message_body="Hi there",
        conversation_urn_id=None,
        recipients=["urn1", "urn2"],
    )


def test_send_message_empty_body(mock_client):
    from src.tools.messaging import handle_send_message

    result = handle_send_message("   ", conversation_urn_id="conv123")

    assert result["success"] is False
    assert result["errorCode"] == "VALIDATION_ERROR"
    mock_client.send_message.assert_not_called()


def test_send_message_no_target(mock_client):
    from src.tools.messaging import handle_send_message

    result = handle_send_message("Hello!")

    assert result["success"] is False
    assert result["errorCode"] == "VALIDATION_ERROR"
    mock_client.send_message.assert_not_called()


def test_send_message_handles_error(mock_client):
    mock_client.send_message.side_effect = Exception("Recipient not found")

    from src.tools.messaging import handle_send_message

    result = handle_send_message("Hello!", conversation_urn_id="conv123")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"


# --- get_conversation ---


def test_get_conversation_returns_messages(mock_client):
    mock_client.get_conversation.return_value = {
        "events": [
            {
                "eventContent": {
                    "com.linkedin.voyager.messaging.event.MessageEvent": {
                        "body": "Hey!",
                    }
                },
                "from": {
                    "com.linkedin.voyager.messaging.MessagingMember": {
                        "miniProfile": {"firstName": "John", "lastName": "Doe"}
                    }
                },
                "createdAt": 1700000000000,
            },
            {
                "eventContent": {
                    "com.linkedin.voyager.messaging.event.MessageEvent": {
                        "body": "Hi John!",
                    }
                },
                "from": {
                    "com.linkedin.voyager.messaging.MessagingMember": {
                        "miniProfile": {"firstName": "Jane", "lastName": "Smith"}
                    }
                },
                "createdAt": 1700000001000,
            },
        ]
    }

    from src.tools.messaging import handle_get_conversation

    result = handle_get_conversation("conv123")

    assert result["success"] is True
    assert result["data"]["conversationId"] == "conv123"
    assert result["data"]["count"] == 2
    assert result["data"]["messages"][0]["text"] == "Hey!"
    assert result["data"]["messages"][0]["sender"] == "John Doe"
    assert result["data"]["messages"][1]["text"] == "Hi John!"
    assert result["data"]["messages"][1]["sender"] == "Jane Smith"


def test_get_conversation_empty(mock_client):
    mock_client.get_conversation.return_value = {"events": []}

    from src.tools.messaging import handle_get_conversation

    result = handle_get_conversation("conv123")

    assert result["success"] is True
    assert result["data"]["count"] == 0


def test_get_conversation_handles_error(mock_client):
    mock_client.get_conversation.side_effect = Exception("Not found")

    from src.tools.messaging import handle_get_conversation

    result = handle_get_conversation("conv123")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"
