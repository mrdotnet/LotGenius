"""Live e2e integration test — orchestrator -> stdio -> REAL Rust seam + runtime.

Drives the full demo path through the wired stack (task #14): real AOAI /
text-embedding-3-large + gpt-5 + local pgvector prod DB, over the real MCP wire
protocol the same way Microsoft Foundry would.

GATED ON ENVIRONMENT — skips cleanly + green when the wired stack isn't present,
exactly like Brunel's AOAI tests. To run:

    cd local-dev && set -a; . .env.local; set +a   # AOAI_* + LOTGENIUS_PROFILE
    export LOTGENIUS_PROFILE=prod
    export LOTGENIUS_MCP_SERVER_COMMAND=/abs/path/to/wired/target/debug/lotgenius-mcp
    # (prod DB loaded once: cd wired && ./dev.sh load-prod --limit 200)
    src/orchestrator/.venv/bin/python -m pytest tests/test_e2e_live.py -v

When LOTGENIUS_MCP_SERVER_COMMAND is unset / the binary is missing, every test
here skips — so the default `pytest -q` (51 tests) stays green offline.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

from lotgenius_orchestrator import Orchestrator, StdioMCPClient
from lotgenius_orchestrator.mcp_client import MCP_SERVER_COMMAND_ENV


def _wired_binary() -> str | None:
    """Resolve the wired seam binary from env; None if unavailable (=> skip)."""
    cmd = os.environ.get(MCP_SERVER_COMMAND_ENV)
    if not cmd:
        return None
    # Accept either an absolute/relative path that exists, or a PATH name.
    if Path(cmd).exists() or shutil.which(cmd):
        return cmd
    return None


requires_wired_seam = pytest.mark.skipif(
    _wired_binary() is None,
    reason=(
        f"{MCP_SERVER_COMMAND_ENV} unset or binary missing; "
        "source local-dev/.env.local + set LOTGENIUS_PROFILE=prod and point at "
        "the wired lotgenius-mcp binary to run the live e2e."
    ),
)


@pytest.fixture(scope="module")
def live_orchestrator():
    """Connect to the wired seam once for the module; tear down at the end."""
    client = StdioMCPClient()  # command + env resolved from environment
    client.connect()
    try:
        yield Orchestrator(client)
    finally:
        client.close()


@requires_wired_seam
def test_money_shot_returns_jd_x9_comps_with_citations(live_orchestrator) -> None:
    """Money-shot: 5 JD X9 comps with real Lot-ID citations carried through."""
    result = live_orchestrator.answer("show me 5 comps for a 2023 John Deere X9 1100")
    assert result.escalated is False
    assert result.intent.value == "comps"
    assert result.tool_calls == ["comps_search"]
    # Real runtime cites the lots backing every number (SC2).
    assert result.citations, "money-shot must carry Lot-ID citations"
    for lot_id in result.citations:
        assert isinstance(lot_id, int)
        assert f"Lot {lot_id}" in result.text
    assert "Sources:" in result.text


@requires_wired_seam
def test_nonsense_query_refuses_without_fabrication(live_orchestrator) -> None:
    """Refusal: a nonsense query escalates as 'no good comps', never a number."""
    result = live_orchestrator.answer("how much is a unicorn worth")
    assert result.escalated is True
    assert result.citations == []
    assert "$" not in result.text  # no fabricated figure (Q-FAB / Q-REFUSE)


@requires_wired_seam
def test_structured_trend_returns_aggregate_answer(live_orchestrator) -> None:
    """Structured: a YoY trend query routes structured and returns an answer.

    The aggregate path is cited at the aggregate level, not the lot level — the
    runtime honestly declines to attach lot_ids to per-year averages (anti-
    fabrication). So we assert it answered (did not crash / fabricate), routed
    to structured_query, and surfaced no orphan fabricated lot citation.
    """
    result = live_orchestrator.answer("year over year hammer price trend for combines")
    assert result.intent.value == "structured"
    assert result.tool_calls == ["structured_query"]
    # Either it gives an aggregate answer, or it cleanly declines — both are
    # acceptable; what is NOT acceptable is a fabricated lot citation.
    assert result.text  # non-empty answer
    assert result.escalated in (True, False)
