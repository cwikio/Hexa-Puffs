"""Unit tests for post tools."""


def test_get_feed_posts_returns_posts(mock_client):
    mock_client.get_feed_posts.return_value = [
        {
            "author_name": "John Doe",
            "commentary": "Great day for coding!",
            "num_likes": 42,
            "num_comments": 5,
            "urn": "urn:li:activity:123",
        },
        {
            "actor_name": "Jane Smith",
            "text": "Just shipped a new feature.",
            "num_likes": 100,
            "num_comments": 12,
            "activityUrn": "urn:li:activity:456",
        },
    ]

    from src.tools.posts import handle_get_feed_posts

    result = handle_get_feed_posts(limit=10)

    assert result["success"] is True
    assert result["data"]["count"] == 2
    assert result["data"]["posts"][0]["author"] == "John Doe"
    assert result["data"]["posts"][0]["text"] == "Great day for coding!"
    assert result["data"]["posts"][0]["numLikes"] == 42
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
        {"commentary": long_text, "author_name": "Test"},
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
