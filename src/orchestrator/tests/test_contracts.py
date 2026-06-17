"""Contract conformance — fixtures match the published MCP outputSchemas, the
client seam rejects unknown tools, and the agent definition binds all 4 tools.

Keeps the deliverable honest against contracts/*.schema.json (PRD §9: we consume
the interface, not the implementation).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from lotgenius_orchestrator import MockMCPClient
from lotgenius_orchestrator.mcp_client import PUBLISHED_TOOLS, MCPToolError

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = ROOT.parent / "mcp-server" / "contracts"
FIXTURES_DIR = ROOT / "fixtures"
AGENT_DEF = ROOT / "agent" / "agent_definition.json"

TOOL_TO_FIXTURE_KEY = {
    "comps_search": "comps_search",
    "structured_query": "structured_query",
    "analyze": "analyze",
}


def _output_schema(tool: str) -> dict:
    contract = json.loads((CONTRACTS_DIR / f"{tool}.schema.json").read_text())
    return contract["outputSchema"]


def _fixture_scenarios() -> list[str]:
    return [p.stem for p in FIXTURES_DIR.glob("*.json")]


@pytest.mark.parametrize("scenario", _fixture_scenarios())
def test_fixture_responses_conform_to_output_schema(scenario: str) -> None:
    """Every tool response in every fixture validates against its outputSchema."""
    fixture = json.loads((FIXTURES_DIR / f"{scenario}.json").read_text())
    for tool, key in TOOL_TO_FIXTURE_KEY.items():
        if key not in fixture:
            continue  # not every scenario calls every tool
        validator = Draft7Validator(_output_schema(tool))
        errors = sorted(validator.iter_errors(fixture[key]), key=lambda e: e.path)
        assert not errors, (
            f"{scenario}/{tool} violates schema: "
            + "; ".join(e.message for e in errors)
        )


def test_all_four_contracts_load() -> None:
    """The deliverable binds exactly the four published tools."""
    on_disk = {p.name.removesuffix(".schema.json") for p in CONTRACTS_DIR.glob("*.schema.json")}
    assert set(PUBLISHED_TOOLS) == on_disk


def test_mock_client_rejects_unknown_tool() -> None:
    client = MockMCPClient()
    client.scenario = "money_shot"
    with pytest.raises(MCPToolError):
        client.call_tool("definitely_not_a_tool", {})


def test_agent_definition_binds_all_four_tools_and_is_mi_auth() -> None:
    """Agent definition: 4 MCP tool bindings, gpt-4o-mini intent model, MI auth."""
    definition = json.loads(AGENT_DEF.read_text())
    bound = {t["name"] for t in definition["tools"]}
    assert bound == set(PUBLISHED_TOOLS)
    assert definition["model"]["deployment"] == "gpt-4o-mini"
    # PRD §8.1: managed identity, never a shared key.
    assert definition["auth"]["to_mcp_server"] == "managed_identity"
    assert definition["auth"]["shared_key"] is False


def test_agent_tool_contracts_point_at_real_schema_files() -> None:
    definition = json.loads(AGENT_DEF.read_text())
    for tool in definition["tools"]:
        ref = (AGENT_DEF.parent / tool["contract"]).resolve()
        assert ref.exists(), f"{tool['name']} contract path missing: {ref}"


def _input_schema(tool: str) -> dict:
    contract = json.loads((CONTRACTS_DIR / f"{tool}.schema.json").read_text())
    return contract["inputSchema"]


# Gold queries spanning all three routes; each must construct tool-call
# arguments that validate against the target tool's inputSchema (F-1).
GOLD_QUERIES = [
    "Show me 5 comps for a 2023 John Deere X9 1100",
    "What did 2023 John Deere X9 1100 combines sell for?",
    "Find me comparable lots for a Case IH 8250",
    "What is the average price of combines?",
    "Show the price trend for tractors over time",
    "How many lots sold by region last year?",
    "How do recent John Deere X9 sales compare, and what's the average price by region?",
    "2023 John Deere X9 1100 combine",
]


@pytest.mark.parametrize("query", GOLD_QUERIES)
def test_constructed_tool_call_arguments_validate_against_input_schema(query: str) -> None:
    """Every tool-call the router builds must satisfy the tool's inputSchema (F-1)."""
    from lotgenius_orchestrator.router import route

    plan = route(query)
    assert plan.tool_calls, f"no tool calls constructed for: {query!r}"
    for call in plan.tool_calls:
        validator = Draft7Validator(_input_schema(call.tool))
        errors = sorted(validator.iter_errors(call.arguments), key=lambda e: e.path)
        assert not errors, (
            f"{query!r} -> {call.tool} args violate inputSchema: "
            + "; ".join(e.message for e in errors)
        )
