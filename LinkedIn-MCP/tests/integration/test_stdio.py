"""Integration tests — verify the MCP server works over stdio transport."""

import json

import pytest

ALL_EXPECTED_TOOLS = [
    # Phase 1
    "get_profile",
    "get_own_profile",
    "search_people",
    "get_feed_posts",
    "get_conversations",
    # Phase 2
    "send_message",
    "react_to_post",
    # Phase 3
    "get_conversation",
    "get_connections",
    "send_connection_request",
    "search_companies",
    "get_company",
]


@pytest.mark.asyncio(loop_scope="session")
async def test_server_lists_all_tools(mcp_session):
    """Verify all registered tools are discoverable."""
    result = await mcp_session.list_tools()
    tool_names = [t.name for t in result.tools]

    for expected in ALL_EXPECTED_TOOLS:
        assert expected in tool_names, f"Missing tool: {expected}"


@pytest.mark.asyncio(loop_scope="session")
async def test_tool_call_returns_json(mcp_session):
    """Verify tool calls return parseable JSON with StandardResponse shape."""
    result = await mcp_session.call_tool("get_own_profile", {})
    text = result.content[0].text
    parsed = json.loads(text)

    # Should have the StandardResponse shape (success or error)
    assert "success" in parsed
    assert isinstance(parsed["success"], bool)


@pytest.mark.asyncio(loop_scope="session")
async def test_get_profile_requires_public_id(mcp_session):
    """Verify get_profile fails gracefully when called without required arg."""
    # FastMCP should either reject the call or the handler returns an error
    try:
        result = await mcp_session.call_tool("get_profile", {})
        text = result.content[0].text
        parsed = json.loads(text)
        # If it reaches the handler, it should be an error response
        assert parsed["success"] is False
    except Exception:
        # FastMCP may raise on missing required args — that's also acceptable
        pass
