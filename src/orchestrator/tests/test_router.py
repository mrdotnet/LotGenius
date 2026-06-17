"""Unit tests for the 3-way intent router (QE-PLAN §2 — primary unit level).

Covers the gold-question style: comps vs structured vs both, and asserts both
the routing DECISION and the constructed tool calls (tool names + key args).
"""

from __future__ import annotations

import pytest

from lotgenius_orchestrator.router import Intent, route

# --- Comps routes: the "money shot" and its kin -------------------------------

COMPS_QUERIES = [
    "Show me 5 comps for a 2023 John Deere X9 1100",
    "What did 2023 John Deere X9 1100 combines sell for?",
    "Find me comparable lots for a Case IH 8250",
    "What is this 2021 Kinze 3600 planter worth?",
    "Show me similar tractors to a John Deere 8R 410",
    "comps for a 2020 Bobcat S770 skid steer",
]


@pytest.mark.parametrize("query", COMPS_QUERIES)
def test_comps_queries_route_to_comps_search(query: str) -> None:
    plan = route(query)
    assert plan.intent == Intent.COMPS, plan.rationale
    assert plan.tools == ["comps_search"]
    # The money shot: comps_search is constructed with the verbatim query.
    (call,) = plan.tool_calls
    assert call.arguments["query"] == query
    assert call.tool == "comps_search"


def test_money_shot_carries_top_k_and_floor() -> None:
    plan = route("Show me 5 comps for a 2023 John Deere X9 1100", top_k=5, min_similarity=0.7)
    (call,) = plan.tool_calls
    assert call.arguments["top_k"] == 5
    assert call.arguments["min_similarity"] == 0.7


# --- Structured routes: average / trend / how many / by region ----------------

STRUCTURED_QUERIES = [
    ("What is the average price of combines?", "avg_price_by_category"),
    ("Show the price trend for tractors over time", "price_trend_by_category"),
    ("How many lots sold by region last year?", "count_by_region"),
    ("What's the average sprayer price?", "avg_price_by_category"),
    ("Number of planters by region", "count_by_region"),
]


@pytest.mark.parametrize("query,expected_template", STRUCTURED_QUERIES)
def test_structured_queries_route_to_structured_query(query: str, expected_template: str) -> None:
    plan = route(query)
    assert plan.intent == Intent.STRUCTURED, plan.rationale
    assert plan.tools == ["structured_query"]
    (call,) = plan.tool_calls
    assert call.tool == "structured_query"
    assert call.arguments["template"] == expected_template


def test_average_price_of_combines_extracts_category_param() -> None:
    plan = route("What is the average price of combines?")
    (call,) = plan.tool_calls
    assert call.arguments["template"] == "avg_price_by_category"
    assert call.arguments["params"].get("category") == "combine"


def test_structured_template_is_allowlisted() -> None:
    """Router must only ever emit one of the schema's enum templates (no free SQL)."""
    allowlist = {
        "lots_by_ids",
        "avg_price_by_category",
        "price_trend_by_category",
        "count_by_region",
        "top_descriptions_by_performance",
    }
    for query, _ in STRUCTURED_QUERIES:
        plan = route(query)
        (call,) = plan.tool_calls
        assert call.arguments["template"] in allowlist


# --- Mixed routes: both tools -------------------------------------------------

BOTH_QUERIES = [
    "How do recent John Deere X9 sales compare, and what's the average price by region?",
    "Show me comps for a Case IH 8250 and the average price by category",
    "What did similar combines sell for and how many sold by region?",
]


@pytest.mark.parametrize("query", BOTH_QUERIES)
def test_mixed_queries_route_to_both(query: str) -> None:
    plan = route(query)
    assert plan.intent == Intent.BOTH, plan.rationale
    assert plan.tools == ["comps_search", "structured_query"]
    # comps_search is first (vector finds the lots), structured_query second.
    assert plan.tool_calls[0].tool == "comps_search"
    assert plan.tool_calls[1].tool == "structured_query"


# --- Default + degenerate cases ----------------------------------------------

def test_bare_equipment_description_defaults_to_comps() -> None:
    plan = route("2023 John Deere X9 1100 combine")
    assert plan.intent == Intent.COMPS
    assert plan.tools == ["comps_search"]


@pytest.mark.parametrize("query", ["", "   ", "\n"])
def test_empty_query_routes_to_none(query: str) -> None:
    plan = route(query)
    assert plan.intent == Intent.NONE
    assert plan.tool_calls == []
