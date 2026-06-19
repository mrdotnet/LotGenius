"""FastAPI app factory + the long-lived locked-seam orchestrator session.

The seam is ONE subprocess (the wired Rust MCP binary over stdio), so we hold a
single long-lived StdioMCPClient for the server's lifetime and serialize calls
with a lock — concurrent /ask requests cannot interleave on one stdio pipe.

For tests, a MockMCPClient (or any MCPClient) can be injected via
``create_app(client=...)`` so the HTTP surface is exercised with no Azure / no
runtime, exactly like the rest of the offline suite.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

from pydantic import BaseModel

from ..demo import DEFAULT_DEMO_ROLE, DEMO_CALLERS, demo_caller
from ..identity import CallerIdentity
from ..mcp_client import HttpMCPClient, MCPClient, MockMCPClient, StdioMCPClient
from ..orchestrator import Orchestrator
from .page import INDEX_HTML

# Env that selects the live HTTP seam (carries caller headers per request).
MCP_SERVER_URL_ENV = "LOTGENIUS_MCP_SERVER_URL"
# Env that runs the chat surface fully offline against contract fixtures, so a
# demo operator can SEE the PII differential with zero Azure / zero runtime.
DEMO_OFFLINE_ENV = "LOTGENIUS_DEMO_OFFLINE"


class AskRequest(BaseModel):
    """Request body for POST /ask.

    ``role`` is the demo "signed-in user" the question is asked as (basic /
    appraiser / admin). It selects a DemoCaller identity whose caller headers the
    seam resolves to ABAC permissions — switching it is what flips the consignor
    PII between visible (admin) and ``[REDACTED]`` (basic/appraiser). Unknown /
    omitted falls back to the default ``basic`` group.
    """

    query: str
    role: str | None = None


class DemoRoutingMock(MockMCPClient):
    """Offline demo client: picks the fixture scenario from the query text.

    The webapp calls ``Orchestrator.answer(query)`` with no explicit scenario, so
    this maps each demo query to the right contract-shaped fixture — letting one
    long-lived session serve every demo case (and apply the per-caller PII gate
    its base class already enforces). Shared by the offline webapp and the tests.
    """

    def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        caller: CallerIdentity | None = None,
    ) -> dict[str, Any]:
        q = str(arguments.get("query", "")).lower()
        if "unicorn" in q:
            self.scenario = "refusal"
        elif "trend" in q or "year over year" in q:
            self.scenario = "structured"
        else:
            self.scenario = "money_shot"
        return super().call_tool(name, arguments, caller=caller)


def _default_client() -> MCPClient:
    """Pick the seam client from the environment (no hardcoded local-dev path).

    Precedence: live HTTP seam (``$LOTGENIUS_MCP_SERVER_URL``, carries caller
    headers) > offline fixtures (``$LOTGENIUS_DEMO_OFFLINE``) > local stdio seam.
    """
    if os.environ.get(MCP_SERVER_URL_ENV):
        return HttpMCPClient()
    if os.environ.get(DEMO_OFFLINE_ENV):
        return DemoRoutingMock()
    return StdioMCPClient()


class SeamSession:
    """Owns one long-lived MCP client + Orchestrator, with call serialization.

    Lazily connects on first use (or at startup). All tool calls are serialized
    behind a lock because the underlying seam is a single stdio subprocess.
    """

    def __init__(self, client: MCPClient | None = None) -> None:
        # If no client is injected, pick one from the environment (live HTTP
        # seam / offline fixtures / local stdio) — NO hardcoded local-dev path
        # here (PRD §9 IP boundary).
        self._client = client if client is not None else _default_client()
        self._orchestrator = Orchestrator(self._client)
        self._lock = threading.Lock()
        self._connected = False
        # Only a live StdioMCPClient needs connect()/close(); a MockMCPClient
        # (tests) is ready immediately. Keep a typed handle so mypy narrows.
        self._stdio: StdioMCPClient | None = (
            self._client if isinstance(self._client, StdioMCPClient) else None
        )

    def connect(self) -> None:
        """Connect the live seam if needed. Idempotent; safe to call at startup."""
        with self._lock:
            if self._connected:
                return
            if self._stdio is not None:
                self._stdio.connect()
            self._connected = True

    def ask(self, query: str, *, caller: CallerIdentity | None = None) -> dict[str, Any]:
        """Run the orchestrator over the seam for ``query`` as ``caller`` (serialized).

        ``caller`` rides every MCP call (HTTP headers on the live path; the PII
        gate offline) so the consignor block comes back redacted unless the
        caller can_see_pii — the headline differential.
        """
        self.connect()
        start = time.perf_counter()
        with self._lock:
            answer = self._orchestrator.answer(query, caller=caller)
        latency_ms = round((time.perf_counter() - start) * 1000)
        return {
            "answer": answer.text,
            "citations": answer.citations,
            "intent": answer.intent.value,
            "escalated": answer.escalated,
            "consignor": answer.consignor,
            "latency_ms": latency_ms,
        }

    def close(self) -> None:
        """Tear down the live seam subprocess. Idempotent."""
        with self._lock:
            if self._stdio is not None and self._connected:
                self._stdio.close()
            self._connected = False


def create_app(client: MCPClient | None = None):
    """Build the FastAPI app. Inject ``client`` (e.g. MockMCPClient) for tests."""
    from contextlib import asynccontextmanager

    from fastapi import FastAPI
    from fastapi.responses import HTMLResponse, JSONResponse

    session = SeamSession(client=client)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Connect the live seam at startup so /healthz only flips green once the
        # subprocess is up. A MockMCPClient connect() is a no-op.
        try:
            session.connect()
        except Exception:  # noqa: BLE001 - surfaced per-request; don't crash boot
            # Leave unconnected; /ask will retry/raise with a clear error.
            pass
        yield
        session.close()

    app = FastAPI(title="Lot Genius — Appraiser Assistant (local demo)", lifespan=lifespan)

    @app.get("/", response_class=HTMLResponse)
    def index() -> str:
        return INDEX_HTML

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/roles")
    def roles() -> dict[str, Any]:
        """The demo 'signed-in user' options for the selector (mirrors identity.sql)."""
        return {
            "default": DEFAULT_DEMO_ROLE,
            "roles": [
                {
                    "role": dc.role,
                    "label": dc.identity.label,
                    "can_see_pii": dc.can_see_pii,
                    "can_admin": dc.can_admin,
                }
                for dc in DEMO_CALLERS.values()
            ],
        }

    @app.post("/ask")
    def ask(req: AskRequest) -> JSONResponse:
        query = (req.query or "").strip()
        if not query:
            return JSONResponse(status_code=400, content={"error": "empty query"})
        # Resolve the selected demo user to a verified caller identity. Unknown /
        # omitted -> default `basic` group (cannot see PII), exactly as the seam.
        dc = demo_caller(req.role)
        try:
            result = session.ask(query, caller=dc.identity)
        except Exception as exc:  # noqa: BLE001 - return a clean 503 for the UI
            return JSONResponse(
                status_code=503,
                content={"error": f"seam unavailable: {exc}"},
            )
        # Echo back who the question was asked as, so the UI can show the lens
        # ("viewing as Sam — admin · PII visible") next to the answer.
        result["role"] = dc.role
        result["caller_label"] = dc.identity.label
        result["can_see_pii"] = dc.can_see_pii
        return JSONResponse(content=result)

    # Expose the session for tests / shutdown hooks.
    app.state.seam_session = session
    return app
