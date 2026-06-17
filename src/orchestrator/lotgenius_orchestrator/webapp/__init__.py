"""Local demo chat web app — the appraiser-facing Teams stand-in.

LOCAL DEMO CLIENT (deliverable, clearly marked). This is NOT the production
front door — production is Teams / M365 Copilot -> Foundry orchestrator (PRD
§5.1). We have no Teams integration yet, so this FastAPI app is a thin local
stand-in that drives the SAME Orchestrator over the SAME live stdio MCP seam,
so the demo path is real end-to-end (real AOAI/gpt-5 + pgvector behind the seam).

Entry point:
    python -m lotgenius_orchestrator.webapp

Env:
    PORT                          listen port (default 8000)
    LOTGENIUS_MCP_SERVER_COMMAND  the wired seam binary (forwarded to the seam)
    LOTGENIUS_PROFILE=prod        + AOAI_* — forwarded into the spawned seam by
                                  StdioMCPClient (no hardcoded local-dev path).

Endpoints:
    GET  /         -> the chat page (single self-contained HTML, vanilla JS)
    POST /ask      -> {answer, citations, intent, escalated, latency_ms}
    GET  /healthz  -> {status: "ok"}
"""

from .app import create_app

__all__ = ["create_app"]
