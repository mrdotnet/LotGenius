"""FastAPI TestClient tests for the local demo chat web app.

Exercise the HTTP surface (/, /healthz, /ask) with an injected MockMCPClient —
no Azure, no runtime — so the web layer is fully covered offline. The fixtures
are the same contract-shaped ones the rest of the suite uses.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from lotgenius_orchestrator.mcp_client import MockMCPClient
from lotgenius_orchestrator.webapp import create_app


class _RoutingMock(MockMCPClient):
    """A MockMCPClient that selects the fixture scenario from the query.

    The webapp calls Orchestrator.answer(query) with no explicit scenario, so
    this picks the right contract-shaped fixture per demo query — letting the
    single long-lived session serve all three cases.
    """

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        q = str(arguments.get("query", "")).lower()
        if "unicorn" in q:
            self.scenario = "refusal"
        elif "trend" in q or "year over year" in q:
            self.scenario = "structured"
        else:
            self.scenario = "money_shot"
        return super().call_tool(name, arguments)


@pytest.fixture
def client() -> TestClient:
    app = create_app(client=_RoutingMock())
    with TestClient(app) as c:  # triggers lifespan startup/shutdown
        yield c


def test_healthz_ok(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_index_serves_branded_html(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    body = r.text
    assert "Lot Genius" in body
    assert "local demo" in body  # the Teams stand-in tag
    # The three example-query buttons are present.
    assert "show me 5 comps for a 2023 John Deere X9 1100" in body
    assert "how much is a unicorn worth" in body
    assert "year over year hammer price trend for combines" in body


def test_ask_money_shot_returns_answer_and_citations(client: TestClient) -> None:
    r = client.post("/ask", json={"query": "show me 5 comps for a 2023 John Deere X9 1100"})
    assert r.status_code == 200
    data = r.json()
    assert data["escalated"] is False
    assert data["intent"] == "comps"
    assert data["citations"] == [4412, 4380, 4501, 4290, 4188]
    for lot_id in data["citations"]:
        assert f"Lot {lot_id}" in data["answer"]
    assert "Sources:" in data["answer"]
    assert isinstance(data["latency_ms"], int)
    assert data["latency_ms"] >= 0


def test_ask_refusal_escalates_with_no_number(client: TestClient) -> None:
    r = client.post("/ask", json={"query": "how much is a unicorn worth"})
    assert r.status_code == 200
    data = r.json()
    assert data["escalated"] is True
    assert data["citations"] == []
    # A refusal carries no fabricated dollar figure.
    assert "$" not in data["answer"]


def test_ask_structured_answer_has_no_unverified_footer(client: TestClient) -> None:
    r = client.post("/ask", json={"query": "year over year hammer price trend for combines"})
    assert r.status_code == 200
    data = r.json()
    assert data["intent"] == "structured"
    assert data["escalated"] is False
    # The structured fixture cites lot_ids, so it gets Sources, never the
    # 'unverified' footer (the footer only fires for an orphan comps answer).
    assert "unverified" not in data["answer"]


def test_ask_empty_query_is_rejected(client: TestClient) -> None:
    r = client.post("/ask", json={"query": "   "})
    assert r.status_code == 400
    assert "error" in r.json()
