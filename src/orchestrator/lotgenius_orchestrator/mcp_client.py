"""MCP client seam — how the orchestrator reaches the four published tools.

Three implementations behind one small interface so Azure/runtime specifics
stay configurable (per the task brief: "keep Azure specifics behind a small
client seam"):

    MCPClient       abstract base — call_tool(name, arguments) -> dict
    StdioMCPClient  talks to the local Rust MCP seam over stdio (MCP SDK).
                    Used once Brunel's runtime is wired; no Azure needed.
    MockMCPClient   returns contract-shaped fixtures. No Azure, no runtime —
                    this is what makes routing + formatting fully testable now.

The *deployed* path (Foundry Agent Service -> MCP Container App over managed
identity, PRD §8.1) is configured in agent/agent_definition.json and driven by
foundry_app.py; it does not go through this Python client. This seam is the
LOCAL agent loop the QE-PLAN calls the "local e2e (mocked MCP)" path.
"""

from __future__ import annotations

import abc
import asyncio
import json
import os
import threading
from pathlib import Path
from typing import Any

PUBLISHED_TOOLS = ("comps_search", "structured_query", "pii_scrub", "analyze")

# Env var the deployer/test sets to point at the MCP seam binary. The deliverable
# carries NO hardcoded local-dev path (PRD §9 IP boundary) — the command is
# configured, and config defaults to the bare binary name on PATH.
MCP_SERVER_COMMAND_ENV = "LOTGENIUS_MCP_SERVER_COMMAND"
DEFAULT_MCP_SERVER_COMMAND = "lotgenius-mcp"


class MCPToolError(RuntimeError):
    """Raised when an MCP tool call fails or an unknown tool is requested."""


class MCPClient(abc.ABC):
    """Abstract seam to the MCP server.

    Implementations MUST only accept the four published tool names; anything
    else is a contract violation and raises MCPToolError (mirrors the seam's
    own unknown-tool rejection, QE-PLAN §2 / §7.1).
    """

    def _guard(self, name: str) -> None:
        if name not in PUBLISHED_TOOLS:
            raise MCPToolError(
                f"unknown tool {name!r}; published tools are {PUBLISHED_TOOLS}"
            )

    @abc.abstractmethod
    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Invoke ``name`` with ``arguments`` and return the tool's output object."""
        raise NotImplementedError


class StdioMCPClient(MCPClient):
    """Talk to the local Rust MCP seam over stdio using the MCP SDK.

    This is the bridge to Brunel's runtime once it is built. It is intentionally
    lazy about importing ``mcp`` so the package imports cleanly (and the mocked
    tests run) on a machine without the MCP SDK / runtime present.

    The runtime is NOT vendored here (PRD §9 IP boundary) — we only speak the
    wire protocol to whatever binary ``command`` launches.

    The MCP SDK is async (asyncio context managers); this client keeps the
    stdio subprocess + session alive on a dedicated background event-loop thread
    and exposes the synchronous ``call_tool`` the orchestrator expects. The
    server command/args/env are CONFIGURED (constructor or env), so the
    deliverable never hardcodes a ``local-dev/`` path.

    Args:
        command: Path or PATH-name of the MCP seam binary. Defaults to
            ``$LOTGENIUS_MCP_SERVER_COMMAND`` or the bare ``lotgenius-mcp`` name.
        args: Extra argv for the binary (e.g. a stdio flag if the seam needs it).
        env: Process env handed to the child. Defaults to the parent environment
            so a profile/creds set externally (e.g. LOTGENIUS_PROFILE=prod,
            AOAI_*) propagate to the seam — the same forwarding the seam expects.
    """

    def __init__(
        self,
        command: str | None = None,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        self.command = command or os.environ.get(
            MCP_SERVER_COMMAND_ENV, DEFAULT_MCP_SERVER_COMMAND
        )
        self.args = args or []
        # Forward the parent env by default (StdioServerParameters otherwise
        # launches the child with a minimal default env, dropping LOTGENIUS_* /
        # AOAI_*). Caller may override with an explicit env dict.
        self.env = env if env is not None else dict(os.environ)

        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._session: Any = None
        self._stack: Any = None  # AsyncExitStack holding the stdio + session CMs

    def connect(self, timeout: float = 60.0) -> None:
        """Spawn the seam binary over stdio and complete the MCP handshake.

        Requires the ``mcp`` SDK installed and a runnable seam binary. Raises
        MCPToolError with a clear message if either is missing.
        """
        try:
            import mcp  # noqa: F401  (import-time availability check)
        except ImportError as exc:  # pragma: no cover - environment-dependent
            raise MCPToolError(
                "mcp SDK not installed; install `mcp>=1.2.0` (the `azure` extra) "
                "to drive the live stdio seam."
            ) from exc

        # Start a dedicated event loop on a background thread.
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._loop.run_forever, name="mcp-stdio-loop", daemon=True
        )
        self._thread.start()

        try:
            self._run(self._aconnect(), timeout=timeout)
        except Exception as exc:
            self.close()
            raise MCPToolError(f"failed to connect to MCP seam: {exc}") from exc

    async def _aconnect(self) -> None:
        from contextlib import AsyncExitStack

        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        params = StdioServerParameters(command=self.command, args=self.args, env=self.env)
        stack = AsyncExitStack()
        read, write = await stack.enter_async_context(stdio_client(params))
        session = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        self._stack = stack
        self._session = session

    def call_tool(
        self, name: str, arguments: dict[str, Any], timeout: float = 90.0
    ) -> dict[str, Any]:
        self._guard(name)
        if self._session is None:
            raise MCPToolError("not connected; call connect() first")
        return self._run(self._acall(name, arguments), timeout=timeout)

    async def _acall(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = await self._session.call_tool(name, arguments)
        if getattr(result, "isError", False):
            raise MCPToolError(f"tool {name!r} returned an error: {result}")
        # Tools return a single text content block carrying a JSON string.
        try:
            text = result.content[0].text  # type: ignore[union-attr]
        except (AttributeError, IndexError) as exc:
            raise MCPToolError(f"tool {name!r} returned no text content") from exc
        return json.loads(text)

    def _run(self, coro: Any, timeout: float) -> Any:
        """Marshal a coroutine onto the background loop and block for the result."""
        if self._loop is None:  # pragma: no cover - defensive
            raise MCPToolError("event loop not running; call connect() first")
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result(timeout=timeout)

    def close(self) -> None:
        """Tear down the session, subprocess, and background loop. Idempotent."""
        loop = self._loop
        if loop is not None and self._stack is not None:
            async def _aclose() -> None:
                await self._stack.aclose()

            try:
                asyncio.run_coroutine_threadsafe(_aclose(), loop).result(timeout=15.0)
            except Exception:  # noqa: BLE001 - best-effort teardown
                pass
        self._stack = None
        self._session = None
        if loop is not None:
            loop.call_soon_threadsafe(loop.stop)
        if self._thread is not None:
            self._thread.join(timeout=5.0)
        if loop is not None:
            loop.close()
        self._loop = None
        self._thread = None

    def __enter__(self) -> StdioMCPClient:
        self.connect()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class MockMCPClient(MCPClient):
    """Contract-shaped, deterministic MCP responses for offline testing.

    Loads fixtures keyed by tool name from a directory of JSON files (default:
    ``fixtures/``). Every fixture is shaped to satisfy the corresponding
    ``outputSchema`` in contracts/*.schema.json, so routing + fusion +
    formatting are exercised against realistic data with zero Azure.

    Fixture selection is keyed by a route token the test/harness supplies, so a
    single client can serve both an answerable money-shot and a refusal case.
    """

    def __init__(self, fixtures_dir: Path | None = None) -> None:
        self.fixtures_dir = fixtures_dir or (Path(__file__).resolve().parent.parent / "fixtures")
        self._cache: dict[str, dict[str, Any]] = {}
        # The fixture "scenario" the next call_tool should answer from. The
        # orchestrator sets this per-query so one client serves many scenarios.
        self.scenario: str = "money_shot"

    def _load(self, scenario: str) -> dict[str, Any]:
        if scenario not in self._cache:
            path = self.fixtures_dir / f"{scenario}.json"
            if not path.exists():
                raise MCPToolError(f"no fixture for scenario {scenario!r} at {path}")
            self._cache[scenario] = json.loads(path.read_text())
        return self._cache[scenario]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self._guard(name)
        fixture = self._load(self.scenario)
        if name not in fixture:
            raise MCPToolError(
                f"fixture {self.scenario!r} has no response for tool {name!r}"
            )
        return fixture[name]
