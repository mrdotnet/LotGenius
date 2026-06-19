"""MCP client seam — how the orchestrator reaches the four published tools.

Three implementations behind one small interface so Azure/runtime specifics
stay configurable (per the task brief: "keep Azure specifics behind a small
client seam"):

    MCPClient       abstract base — call_tool(name, arguments) -> dict
    StdioMCPClient  talks to the local Rust MCP seam over stdio (MCP SDK).
                    Used once Brunel's runtime is wired; no Azure needed.
    MockMCPClient   returns contract-shaped fixtures. No Azure, no runtime —
                    this is what makes routing + formatting fully testable now.

Every implementation accepts an optional ``caller`` — the signed-in user the
call is made on behalf of. For the HTTP transport the caller rides as the
``x-lotgenius-caller-*`` headers the seam trusts (Item 3); the seam strips any
in-band copy and resolves ABAC permissions out of band, so this is what makes the
field-level PII gate take effect end-to-end. For the mock, ``caller`` drives the
offline PII differential (admin sees consignor PII; basic/appraiser get
``[REDACTED]``) — the headline Teams demo.

The *deployed* path (Foundry Agent Service -> MCP Container App over managed
identity, PRD §8.1) is configured in agent/agent_definition.json and driven by
foundry_app.py. ``HttpMCPClient`` is the direct client-side path to that same
Container App (used by the local chat webapp pointed at the live seam).
"""

from __future__ import annotations

import abc
import asyncio
import json
import os
import threading
from pathlib import Path
from typing import Any

from .demo import resolve_demo_pii
from .identity import CallerIdentity

PUBLISHED_TOOLS = ("comps_search", "structured_query", "pii_scrub", "analyze")

# Env var the deployer/test sets to point at the MCP seam binary. The deliverable
# carries NO hardcoded local-dev path (PRD §9 IP boundary) — the command is
# configured, and config defaults to the bare binary name on PATH.
MCP_SERVER_COMMAND_ENV = "LOTGENIUS_MCP_SERVER_COMMAND"
DEFAULT_MCP_SERVER_COMMAND = "lotgenius-mcp"

# Env var pointing at the deployed MCP Container App (the live HTTP seam).
MCP_SERVER_URL_ENV = "LOTGENIUS_MCP_SERVER_URL"

# ---- PII redaction (mock-side emulation of the seam's field-level gate) -------
# The seam + Background-IP runtime redact consignor PII before data leaves the
# boundary UNLESS the resolved caller has can_see_pii (Item 3). The MockMCPClient
# reproduces that gate offline so the demo + tests can show the differential.
REDACTION_MARK = "[REDACTED]"
# Keys whose value IS PII — redacted in place wherever they appear.
_PII_VALUE_KEYS = frozenset({"consignor_name", "consignor_phone", "consignor_email"})
# Keys whose whole subtree is PII — every leaf under them is redacted.
_PII_CONTAINER_KEYS = frozenset({"consignor", "top_consignor"})


def _redact_subtree(value: Any) -> Any:
    """Redact every leaf within a PII container (strings and scalars alike)."""
    if isinstance(value, dict):
        return {k: _redact_subtree(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_subtree(v) for v in value]
    return REDACTION_MARK


def redact_pii(obj: Any) -> Any:
    """Return a deep copy of ``obj`` with consignor PII redacted.

    Mirrors the seam's field-level gate: ``consignor_*`` value keys are masked
    wherever they appear, and any ``consignor`` / ``top_consignor`` container has
    all of its leaves masked. Non-PII fields are passed through untouched.
    """
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            if k in _PII_VALUE_KEYS:
                out[k] = REDACTION_MARK
            elif k in _PII_CONTAINER_KEYS:
                out[k] = _redact_subtree(v)
            else:
                out[k] = redact_pii(v)
        return out
    if isinstance(obj, list):
        return [redact_pii(v) for v in obj]
    return obj


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
    def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        caller: CallerIdentity | None = None,
    ) -> dict[str, Any]:
        """Invoke ``name`` with ``arguments`` on behalf of ``caller``.

        ``caller`` is the signed-in user the call is made for. The HTTP transport
        forwards it as the ``x-lotgenius-caller-*`` headers the seam trusts;
        ``None`` means anonymous (the seam applies the default ``basic`` group).
        """
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
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        caller: CallerIdentity | None = None,
        timeout: float = 90.0,
    ) -> dict[str, Any]:
        self._guard(name)
        if self._session is None:
            raise MCPToolError("not connected; call connect() first")
        # stdio carries no per-request headers, so the seam cannot read a caller
        # off the wire here — on this path it resolves identity from the
        # LOTGENIUS_DEV_CALLER env set when the subprocess was spawned (see
        # src/mcp-server/src/identity.rs `extract()`). A per-call ``caller`` is
        # therefore accepted for interface parity but NOT forwarded; the HTTP
        # transport (HttpMCPClient) is the path that carries per-call identity.
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


class HttpMCPClient(MCPClient):
    """Talk to the deployed MCP Container App (the seam) over streamable HTTP.

    This is the direct client-side path the local chat webapp uses when it is
    pointed at the LIVE seam (``$LOTGENIUS_MCP_SERVER_URL``). Its whole reason to
    exist over ``StdioMCPClient`` is that HTTP can carry the caller on the wire:
    each call attaches the ``x-lotgenius-caller-*`` headers the seam trusts
    (Item 3), so the seam resolves ABAC permissions out of band and enforces the
    field-level PII gate per request. ``StdioMCPClient`` cannot do this — stdio
    has no per-request headers — which is why per-caller switching is an HTTP-only
    capability.

    The runtime is NOT vendored (PRD §9 IP boundary); we only speak the MCP wire
    protocol to whatever the URL serves. The ``mcp`` SDK is imported lazily so the
    package (and the offline tests) load without it installed.

    Auth: the seam is reached over managed identity from Foundry in production
    (PRD §8.1). For a local operator driving the live seam, an optional bearer
    ``auth_token`` is attached as ``Authorization``; there is deliberately no
    shared-key path. Identity headers and the auth token are orthogonal — the
    token authenticates the *front door*, the caller headers carry the *end user*.

    A fresh MCP session is opened per call (connect → initialize → call). That is
    intentionally simple for a low-volume demo and makes per-call caller switching
    trivially correct. A production multi-user front door would instead pin one
    caller per session/connection rather than per call.
    """

    def __init__(
        self,
        url: str | None = None,
        *,
        base_headers: dict[str, str] | None = None,
        auth_token: str | None = None,
    ) -> None:
        resolved = url or os.environ.get(MCP_SERVER_URL_ENV)
        if not resolved:
            raise MCPToolError(
                f"no MCP server URL; pass url= or set ${MCP_SERVER_URL_ENV}"
            )
        self.url = resolved
        self._base_headers = dict(base_headers or {})
        if auth_token:
            self._base_headers["Authorization"] = f"Bearer {auth_token}"

    def _headers_for(self, caller: CallerIdentity | None) -> dict[str, str]:
        """Build the request headers: base/auth headers + the caller envelope.

        Pure and side-effect-free so the header-propagation contract is unit
        testable without a live server. The caller's own headers win over any
        same-named base header, and an anonymous caller adds none (the seam then
        applies the default ``basic`` group).
        """
        headers = dict(self._base_headers)
        if caller is not None:
            headers.update(caller.headers())
        return headers

    def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        caller: CallerIdentity | None = None,
        timeout: float = 90.0,
    ) -> dict[str, Any]:
        self._guard(name)
        return asyncio.run(self._acall(name, arguments, caller))

    async def _acall(
        self, name: str, arguments: dict[str, Any], caller: CallerIdentity | None
    ) -> dict[str, Any]:
        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client
        except ImportError as exc:  # pragma: no cover - environment-dependent
            raise MCPToolError(
                "mcp SDK not installed; install `mcp>=1.2.0` (the `web`/`azure` "
                "extra) to drive the live HTTP seam."
            ) from exc

        headers = self._headers_for(caller)
        async with streamablehttp_client(self.url, headers=headers) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(name, arguments)
        if getattr(result, "isError", False):
            raise MCPToolError(f"tool {name!r} returned an error: {result}")
        try:
            text = result.content[0].text  # type: ignore[union-attr]
        except (AttributeError, IndexError) as exc:
            raise MCPToolError(f"tool {name!r} returned no text content") from exc
        return json.loads(text)


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

    def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        caller: CallerIdentity | None = None,
    ) -> dict[str, Any]:
        self._guard(name)
        fixture = self._load(self.scenario)
        if name not in fixture:
            raise MCPToolError(
                f"fixture {self.scenario!r} has no response for tool {name!r}"
            )
        result = fixture[name]
        # Emulate the seam's field-level PII gate (Item 3): consignor PII leaves
        # the boundary ONLY for a caller the runtime resolves to can_see_pii.
        # Offline, resolve_demo_pii() stands in for app_resolve_permissions().
        # Anonymous/unknown -> default `basic` group -> redacted.
        if not resolve_demo_pii(caller):
            result = redact_pii(result)
        return result
