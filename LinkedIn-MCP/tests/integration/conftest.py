"""Integration test fixtures — spawn LinkedIn MCP as subprocess."""

import os
import sys
from pathlib import Path

import pytest

# Ensure src is importable
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

SERVER_PATH = PROJECT_ROOT / "src" / "main.py"
# IMPORTANT: Do NOT resolve() the venv python path.
# .venv/bin/python is a symlink to the system python; resolve() follows it,
# which makes CPython lose the venv prefix and miss site-packages.
VENV_PYTHON = PROJECT_ROOT / ".venv" / "bin" / "python"


@pytest.fixture(scope="session")
async def mcp_session():
    """Spawn LinkedIn MCP as a subprocess and connect via stdio.

    Uses the Python MCP SDK client to communicate with the server
    over stdin/stdout, mirroring how the Orchestrator would connect.

    We manually enter/exit the async context managers to avoid the
    anyio "cancel scope in different task" teardown error that occurs
    when pytest-asyncio finalizes a session-scoped yielding fixture.
    """
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    # Build a clean env: strip vars from the parent that would
    # confuse the child venv python's module resolution
    strip_keys = {"VIRTUAL_ENV", "CONDA_PREFIX", "CONDA_DEFAULT_ENV", "PYTHONHOME", "PYTHONPATH"}
    clean_env = {k: v for k, v in os.environ.items() if k not in strip_keys}
    # Point VIRTUAL_ENV at the correct venv so the child python
    # picks up the right site-packages
    clean_env["VIRTUAL_ENV"] = str(VENV_PYTHON.parent.parent)

    server_params = StdioServerParameters(
        command=str(VENV_PYTHON),
        args=[str(SERVER_PATH)],
        env=clean_env,
        cwd=str(PROJECT_ROOT),
    )

    # Manually manage context managers so teardown stays in the same task
    stdio_cm = stdio_client(server_params)
    read, write = await stdio_cm.__aenter__()
    session_cm = ClientSession(read, write)
    session = await session_cm.__aenter__()
    await session.initialize()

    yield session

    # Teardown in same task context
    try:
        await session_cm.__aexit__(None, None, None)
    except Exception:
        pass
    try:
        await stdio_cm.__aexit__(None, None, None)
    except Exception:
        pass
