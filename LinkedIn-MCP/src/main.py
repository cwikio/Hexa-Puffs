"""
LinkedIn MCP server entry point.

Runs on stdio transport via FastMCP. All logging goes to stderr
so it never corrupts the JSON-RPC stdio channel.
"""

import logging
import sys
from pathlib import Path

# Configure logging to stderr before any other imports.
# Keep format minimal — the Orchestrator wraps child stderr with its own
# timestamp, level, and [mcp:linkedin] context prefix.
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(message)s",
)

# Load .env from the project root (same dir as package.json)
# Guard with existsSync to avoid dotenv writing noise to stdout
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_path)


from fastmcp import FastMCP  # noqa: E402

from src.tools.profile import register_profile_tools  # noqa: E402
from src.tools.posts import register_post_tools  # noqa: E402
from src.tools.search import register_search_tools  # noqa: E402
from src.tools.messaging import register_messaging_tools  # noqa: E402
from src.tools.network import register_network_tools  # noqa: E402

mcp = FastMCP("linkedin")

register_profile_tools(mcp)
register_post_tools(mcp)
register_search_tools(mcp)
register_messaging_tools(mcp)
register_network_tools(mcp)

if __name__ == "__main__":
    logging.getLogger("linkedin").info("LinkedIn MCP starting on stdio...")
    mcp.run()
