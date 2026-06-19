"""FastAPI TestClient tests for the local demo chat web app.

Exercise the HTTP surface (/, /healthz, /roles, /ask) with an injected
DemoRoutingMock — no Azure, no runtime — so the web layer is fully covered
offline. The fixtures are the same contract-shaped ones the rest of the suite
uses, and the caller threading drives the headline consignor-PII differential.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from lotgenius_orchestrator.webapp import create_app
from lotgenius_orchestrator.webapp.app import DemoRoutingMock


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(client=DemoRoutingMock())
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
    # The signed-in-user selector + PII indicator are wired into the page.
    assert 'id="role"' in body
    assert 'id="pii"' in body


def test_roles_endpoint_lists_demo_callers(client: TestClient) -> None:
    r = client.get("/roles")
    assert r.status_code == 200
    data = r.json()
    assert data["default"] == "basic"
    roles = {row["role"]: row for row in data["roles"]}
    assert set(roles) == {"basic", "appraiser", "admin"}
    # Only admin can see PII (mirrors infra/db/identity.sql).
    assert roles["admin"]["can_see_pii"] is True
    assert roles["basic"]["can_see_pii"] is False
    assert roles["appraiser"]["can_see_pii"] is False


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


def test_ask_defaults_to_basic_and_redacts_consignor(client: TestClient) -> None:
    """No role supplied -> default `basic` group -> consignor PII is [REDACTED]."""
    r = client.post("/ask", json={"query": "show me 5 comps for a 2023 John Deere X9 1100"})
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == "basic"
    assert data["can_see_pii"] is False
    assert data["consignor"]["consignor_name"] == "[REDACTED]"
    assert data["consignor"]["consignor_phone"] == "[REDACTED]"
    # The cleartext PII never reached the client.
    assert "Dale Branton" not in r.text


def test_ask_admin_sees_consignor_pii(client: TestClient) -> None:
    """The headline differential: admin resolves to can_see_pii -> cleartext consignor."""
    r = client.post(
        "/ask",
        json={"query": "show me 5 comps for a 2023 John Deere X9 1100", "role": "admin"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == "admin"
    assert data["can_see_pii"] is True
    assert data["consignor"]["consignor_name"] == "Dale Branton"
    assert data["consignor"]["consignor_phone"] == "701-555-0142"


def test_ask_appraiser_is_redacted_like_basic(client: TestClient) -> None:
    """Appraiser has comps access but NOT PII (identity.sql) -> redacted consignor."""
    r = client.post(
        "/ask",
        json={"query": "show me 5 comps for a 2023 John Deere X9 1100", "role": "appraiser"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == "appraiser"
    assert data["can_see_pii"] is False
    assert data["consignor"]["consignor_name"] == "[REDACTED]"


def test_ask_unknown_role_falls_back_to_basic(client: TestClient) -> None:
    r = client.post(
        "/ask",
        json={"query": "show me 5 comps for a 2023 John Deere X9 1100", "role": "ceo"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == "basic"
    assert data["consignor"]["consignor_name"] == "[REDACTED]"


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
