"""Unit tests for post tools."""


# --- get_feed_posts ---


def test_get_feed_posts_returns_posts(mock_client):
    # linkedin-api get_feed_posts returns: author_name, author_profile, old, content, url
    mock_client.get_feed_posts.return_value = [
        {
            "author_name": "John Doe",
            "content": "Great day for coding!",
            "author_profile": "https://linkedin.com/in/john-doe",
            "old": "2h",
            "url": "https://linkedin.com/feed/update/urn:li:activity:123",
        },
        {
            "author_name": "Jane Smith",
            "content": "Just shipped a new feature.",
            "author_profile": "https://linkedin.com/in/jane-smith",
            "old": "5h",
            "url": "https://linkedin.com/feed/update/urn:li:activity:456",
        },
    ]

    from src.tools.posts import handle_get_feed_posts

    result = handle_get_feed_posts(limit=10)

    assert result["success"] is True
    assert result["data"]["count"] == 2
    assert result["data"]["posts"][0]["author"] == "John Doe"
    assert result["data"]["posts"][0]["text"] == "Great day for coding!"
    assert result["data"]["posts"][0]["age"] == "2h"
    assert result["data"]["posts"][0]["url"] == "https://linkedin.com/feed/update/urn:li:activity:123"
    assert result["data"]["posts"][1]["author"] == "Jane Smith"


def test_get_feed_posts_empty(mock_client):
    mock_client.get_feed_posts.return_value = []

    from src.tools.posts import handle_get_feed_posts

    result = handle_get_feed_posts()

    assert result["success"] is True
    assert result["data"]["count"] == 0
    assert result["data"]["posts"] == []


def test_get_feed_posts_truncates_long_text(mock_client):
    long_text = "x" * 1000
    mock_client.get_feed_posts.return_value = [
        {"content": long_text, "author_name": "Test"},
    ]

    from src.tools.posts import handle_get_feed_posts

    result = handle_get_feed_posts()

    assert result["success"] is True
    assert len(result["data"]["posts"][0]["text"]) == 500


def test_get_feed_posts_handles_error(mock_client):
    mock_client.get_feed_posts.side_effect = Exception("Network error")

    from src.tools.posts import handle_get_feed_posts

    result = handle_get_feed_posts()

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"


# --- react_to_post ---


def test_react_to_post_success(mock_client):
    mock_client.react_to_post.return_value = False  # False = success

    from src.tools.posts import handle_react_to_post

    result = handle_react_to_post("urn:li:activity:123")

    assert result["success"] is True
    assert result["data"]["reacted"] is True
    assert result["data"]["reactionType"] == "LIKE"
    mock_client.react_to_post.assert_called_once_with("urn:li:activity:123", reaction_type="LIKE")


def test_react_to_post_celebrate(mock_client):
    mock_client.react_to_post.return_value = False

    from src.tools.posts import handle_react_to_post

    result = handle_react_to_post("urn:li:activity:123", "CELEBRATE")

    assert result["success"] is True
    assert result["data"]["reactionType"] == "CELEBRATE"


def test_react_to_post_case_insensitive(mock_client):
    mock_client.react_to_post.return_value = False

    from src.tools.posts import handle_react_to_post

    result = handle_react_to_post("urn:li:activity:123", "empathy")

    assert result["success"] is True
    assert result["data"]["reactionType"] == "EMPATHY"


def test_react_to_post_invalid_type(mock_client):
    from src.tools.posts import handle_react_to_post

    result = handle_react_to_post("urn:li:activity:123", "LOVE")

    assert result["success"] is False
    assert result["errorCode"] == "VALIDATION_ERROR"
    mock_client.react_to_post.assert_not_called()


def test_react_to_post_rejected(mock_client):
    mock_client.react_to_post.return_value = True  # True = error

    from src.tools.posts import handle_react_to_post

    result = handle_react_to_post("urn:li:activity:123")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"


def test_react_to_post_handles_error(mock_client):
    mock_client.react_to_post.side_effect = Exception("Rate limited")

    from src.tools.posts import handle_react_to_post

    result = handle_react_to_post("urn:li:activity:123")

    assert result["success"] is False
    assert result["errorCode"] == "LINKEDIN_ERROR"
