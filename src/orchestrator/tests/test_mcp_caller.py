"""Caller-identity propagation across the MCP client seam (Item 4).

Proves the three load-bearing wiring facts, all offline:
  1. MockMCPClient applies the seam's PII gate by caller (admin sees consignor;
     basic/appraiser/anonymous get [REDACTED]).
  2. HttpMCPClient renders the caller into exactly the headers the Rust seam
     trusts (x-lotgenius-caller-*), merged over base/auth headers — without
     opening a connection.
  3. Orchestrator threads the caller onto EVERY MCP call (retrieval + analyze).
"""

from __future__ import annotations

from typing import Any

import pytest

from lotgenius_orchestrator import (
    CallerIdentity,
    HttpMCPClient,
    MockMCPClient,
    Orchestrator,
    demo_caller,
)
from lotgenius_orchestrator.identity import CALLER_OID_HEADER, CALLER_UPN_HEADER
from lotgenius_orchestrator.mcp_client import MCP_SERVER_URL_ENV, MCPToolError

# ---- MockMCPClient: the seam PII gate, emulated by caller ---------------------


def test_mock_redacts_consignor_for_basic_caller() -> None:
    client = MockMCPClient()
    client.scenario = "money_shot"
    out = client.call_tool("analyze", {"query": "x"}, caller=demo_caller("basic").identity)
    assert out["consignor"]["consignor_name"] == "[REDACTED]"


def test_mock_passes_consignor_for_admin_caller() -> None:
    client = MockMCPClient()
    client.scenario = "money_shot"
    out = client.call_tool("analyze", {"query": "x"}, caller=demo_caller("admin").identity)
    assert out["consignor"]["consignor_name"] == "Dale Branton"
    assert out["consignor"]["consignor_phone"] == "701-555-0142"


def test_mock_redacts_for_anonymous_caller() -> None:
    """No caller -> the seam's default `basic` group -> redacted."""
    client = MockMCPClient()
    client.scenario = "money_shot"
    out = client.call_tool("analyze", {"query": "x"})
    assert out["consignor"]["consignor_name"] == "[REDACTED]"


# ---- HttpMCPClient: caller -> seam-trusted headers ---------------------------


def test_http_client_headers_carry_the_caller() -> None:
    client = HttpMCPClient(url="https://seam.example/mcp")
    headers = client._headers_for(demo_caller("admin").identity)
    assert headers[CALLER_OID_HEADER] == demo_caller("admin").identity.oid
    assert headers[CALLER_UPN_HEADER] == demo_caller("admin").identity.upn


def test_http_client_anonymous_sends_no_caller_headers() -> None:
    client = HttpMCPClient(url="https://seam.example/mcp")
    assert client._headers_for(None) == {}
    assert client._headers_for(CallerIdentity()) == {}


def test_http_client_merges_auth_then_caller_headers() -> None:
    client = HttpMCPClient(
        url="https://seam.example/mcp",
        base_headers={"x-trace": "abc"},
        auth_token="tok",
    )
    headers = client._headers_for(CallerIdentity(oid="o1"))
    assert headers["Authorization"] == "Bearer tok"
    assert headers["x-trace"] == "abc"
    assert headers[CALLER_OID_HEADER] == "o1"


def test_http_client_requires_a_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(MCP_SERVER_URL_ENV, raising=False)
    with pytest.raises(MCPToolError):
        HttpMCPClient()


def test_http_client_reads_url_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(MCP_SERVER_URL_ENV, "https://from-env.example/mcp")
    assert HttpMCPClient().url == "https://from-env.example/mcp"


# ---- Orchestrator threads the caller onto every MCP call ---------------------


class _CallerSpyMock(MockMCPClient):
    """Records the caller passed to each call_tool so we can assert propagation."""

    def __init__(self) -> None:
        super().__init__()
        self.seen: list[tuple[str, CallerIdentity | None]] = []

    def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        caller: CallerIdentity | None = None,
    ) -> dict[str, Any]:
        self.seen.append((name, caller))
        return super().call_tool(name, arguments, caller=caller)


def test_orchestrator_threads_caller_to_every_tool_call() -> None:
    spy = _CallerSpyMock()
    admin = demo_caller("admin").identity
    Orchestrator(spy).answer("show me comps for an X9 1100", scenario="money_shot", caller=admin)
    assert spy.seen, "no MCP calls were made"
    # comps_search + analyze both ran, and BOTH carried the same caller.
    names = [n for n, _ in spy.seen]
    assert "comps_search" in names and names[-1] == "analyze"
    assert all(c is admin for _, c in spy.seen)
