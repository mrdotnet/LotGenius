"""FastAPI app factory + the long-lived locked-seam orchestrator session.

The seam is ONE subprocess (the wired Rust MCP binary over stdio), so we hold a
single long-lived StdioMCPClient for the server's lifetime and serialize calls
with a lock — concurrent /ask requests cannot interleave on one stdio pipe.

For tests, a MockMCPClient (or any MCPClient) can be injected via
``create_app(client=...)`` so the HTTP surface is exercised with no Azure / no
runtime, exactly like the rest of the offline suite.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from pydantic import BaseModel

from ..mcp_client import MCPClient, StdioMCPClient
from ..orchestrator import Orchestrator
from .page import INDEX_HTML


class AskRequest(BaseModel):
    """Request body for POST /ask."""

    query: str


class SeamSession:
    """Owns one long-lived MCP client + Orchestrator, with call serialization.

    Lazily connects on first use (or at startup). All tool calls are serialized
    behind a lock because the underlying seam is a single stdio subprocess.
    """

    def __init__(self, client: MCPClient | None = None) -> None:
        # If no client is injected, build a live stdio client whose command +
        # env come from the environment (StdioMCPClient defaults) — NO hardcoded
        # local-dev path here (PRD §9 IP boundary).
        self._client = client if client is not None else StdioMCPClient()
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

    def ask(self, query: str) -> dict[str, Any]:
        """Run the orchestrator over the live seam for ``query`` (serialized)."""
        self.connect()
        start = time.perf_counter()
        with self._lock:
            answer = self._orchestrator.answer(query)
        latency_ms = round((time.perf_counter() - start) * 1000)
        return {
            "answer": answer.text,
            "citations": answer.citations,
            "intent": answer.intent.value,
            "escalated": answer.escalated,
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

    @app.post("/ask")
    def ask(req: AskRequest) -> JSONResponse:
        query = (req.query or "").strip()
        if not query:
            return JSONResponse(status_code=400, content={"error": "empty query"})
        try:
            result = session.ask(query)
        except Exception as exc:  # noqa: BLE001 - return a clean 503 for the UI
            return JSONResponse(
                status_code=503,
                content={"error": f"seam unavailable: {exc}"},
            )
        return JSONResponse(content=result)

    # Expose the session for tests / shutdown hooks.
    app.state.seam_session = session
    return app
