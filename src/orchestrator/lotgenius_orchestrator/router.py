"""Intent router — the 3-way decision at the heart of the thin orchestrator.

PRD §5.2 (deliberately simple routing):
    - "comparable lots / what did things like X sell for"  -> comps_search
    - "average / trend / how many / by region"             -> structured_query
    - mixed                                                -> call both and fuse

This is the load-bearing decision QE-PLAN §2 pushes to the *unit* level: a pure
function over fixed inputs, no model, no DB. The real Foundry agent uses
gpt-4o-mini for routing (see agent/agent_definition.json); this deterministic
classifier mirrors that policy so routing is fully testable offline and so the
local harness can run without Azure.

The classifier is intentionally lexical/heuristic — it encodes the *same* policy
the gpt-4o-mini system prompt states, so its decisions are auditable and gold-
checkable. It never invents numbers; it only decides which tool(s) to call.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Intent(str, Enum):
    """The routing outcomes.

    COMPS / STRUCTURED / BOTH are the original PRD §5.2 three-way decision.
    REALIZED_VALUE and DEMAND are P0/P2 specializations of the structured path:
    they still call ``structured_query`` (trusted numbers), but the orchestrator
    surfaces them differently — REALIZED_VALUE narrates a "consignor netted ~$Y,
    buyer paid ~$Z all-in (n=…)" line; DEMAND narrates aggregate bid/watch counts.
    """

    COMPS = "comps"
    STRUCTURED = "structured"
    BOTH = "both"
    REALIZED_VALUE = "realized_value"
    DEMAND = "demand"
    NONE = "none"


# Intents whose answer is an aggregate over many lots (provenance is n + filter,
# not a per-lot citation), so the formatter must NOT attach the orphan-number
# "unverified" footer to them.
AGGREGATE_INTENTS = frozenset(
    {Intent.STRUCTURED, Intent.REALIZED_VALUE, Intent.DEMAND}
)


@dataclass(frozen=True)
class ToolCall:
    """A concrete MCP tool invocation the orchestrator will dispatch.

    ``tool`` must be one of the four published contract names. ``arguments`` is
    the JSON-serializable input object validated against that tool's
    ``inputSchema``.
    """

    tool: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class RoutePlan:
    """The router's decision: an intent label plus the ordered tool calls.

    ``tool_calls`` are the *retrieval* calls (comps_search / structured_query).
    The fusing ``analyze`` call is constructed by the orchestrator after the
    retrieval results return, so it is not part of the static plan.
    """

    intent: Intent
    tool_calls: list[ToolCall] = field(default_factory=list)
    rationale: str = ""

    @property
    def tools(self) -> list[str]:
        """Ordered list of tool names this plan will dispatch (for assertions)."""
        return [c.tool for c in self.tool_calls]


# --- Lexical policy signals ---------------------------------------------------
# These mirror the gpt-4o-mini routing system prompt. Keep them in sync with
# agent/agent_definition.json's "routing_policy".

# Aggregate / analytic language -> structured_query (Synapse templates).
_STRUCTURED_SIGNALS = re.compile(
    r"""
    \b(
        average | avg | mean |
        trend | trends | trending | over\s+time | year[\s-]?over[\s-]?year |
        how\s+many | count | number\s+of | total |
        by\s+region | per\s+region | by\s+state | by\s+category | per\s+category |
        median | percentile | distribution |
        most\s+common | top\s+\w+\s+descriptions
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Comparable-lot language -> comps_search (pgvector semantic retrieval).
# The "money shot": "what did X sell for" / "comps for X" / "similar to X".
_COMPS_SIGNALS = re.compile(
    r"""
    \b(
        comp | comps | comparable | comparables | similar | like\s+this |
        compare | how\s+do .* (sales?|lots?) .* compare |
        what\s+did .* sell\s+for |
        show\s+me .* (lots?|comps?) | find\s+(me\s+)?(comparable|similar|comps?) |
        what\s+is .* worth | how\s+much .* worth | value\s+of\s+(this|my|a)
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


# Realized-value language -> realized_value template (P0). True net to consignor /
# all-in cost to buyer, after fees. More specific than generic structured signals,
# so it is checked FIRST.
_REALIZED_SIGNALS = re.compile(
    r"""
    \b(
        net | nets | netted | net\s+proceeds | net\s+to\s+(the\s+)?consignor |
        take[\s-]?home | walk\s+away\s+with | clear\s+after |
        after\s+(fees|commission|commissions|expenses|costs) |
        all[\s-]?in | total\s+cost\s+to\s+(the\s+)?buyer |
        realized\s+(price|value|net|proceeds) |
        actually\s+(net|nets|clear|clears|keep|keeps|get|gets|pay|pays|paid|make|makes) |
        consignor .* (net|nets|receive|receives|get|gets|clear|clears) |
        (net|nets|take[\s-]?home) .* consignor
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Demand / competition language -> demand_metrics template (P2). Aggregate
# bid/watch counts only (never bidder identity).
_DEMAND_SIGNALS = re.compile(
    r"""
    \b(
        how\s+many\s+(bid|bids|bidders|watchers) |
        number\s+of\s+(bid|bids|bidders|watchers) |
        bid(ding)?\s+activity | bid\s+count | bidder\s+count | bid\s+depth |
        how\s+competitive | competition | competitive\s+(was|is) |
        demand\s+for | demand\b | watchers? | watch(ed|list) |
        how\s+much\s+interest | interest\s+in
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# "by state / by county" -> geo rollup grain for realized_value_by_geo.
_GEO_GRAIN_SIGNALS = re.compile(
    r"\bby\s+(state|county)|per\s+(state|county)\b", re.IGNORECASE
)


def _has_structured(query: str) -> bool:
    return bool(_STRUCTURED_SIGNALS.search(query))


def _has_comps(query: str) -> bool:
    return bool(_COMPS_SIGNALS.search(query))


def _has_realized(query: str) -> bool:
    return bool(_REALIZED_SIGNALS.search(query))


def _has_demand(query: str) -> bool:
    return bool(_DEMAND_SIGNALS.search(query))


def _geo_grain(query: str) -> str | None:
    """Return 'state'/'county' if the query asks for a geo rollup, else None."""
    m = _GEO_GRAIN_SIGNALS.search(query)
    if not m:
        return None
    return (m.group(1) or m.group(2) or "").lower() or None


def _build_comps_call(query: str, top_k: int, min_similarity: float) -> ToolCall:
    """Construct a comps_search call bound to comps_search.schema.json."""
    return ToolCall(
        tool="comps_search",
        arguments={
            "query": query,
            "top_k": top_k,
            "min_similarity": min_similarity,
        },
    )


def _structured_template_for(query: str) -> str:
    """Pick an allowlisted structured_query template from query language.

    Templates are the enum in structured_query.schema.json. This is a heuristic
    pre-bind; the real gpt-4o-mini agent picks the template too, and the MCP
    server re-validates the name server-side (never free-form SQL, PRD §5.2).
    """
    q = query.lower()
    if re.search(r"\btrend|over\s+time|year[\s-]?over[\s-]?year\b", q):
        return "price_trend_by_category"
    if re.search(r"\bhow\s+many|count|number\s+of|by\s+region|per\s+region|by\s+state\b", q):
        return "count_by_region"
    if re.search(r"\btop\s+\w+\s+descriptions|most\s+common\s+descriptions\b", q):
        return "top_descriptions_by_performance"
    # Default analytic ask is an average-by-category.
    return "avg_price_by_category"


# Common auction equipment categories, for cheap param extraction in the
# offline harness. The live agent extracts these via the model; here we only
# need enough to construct a plausible, schema-valid params object.
_KNOWN_CATEGORIES = [
    "combine",
    "combines",
    "tractor",
    "tractors",
    "planter",
    "planters",
    "sprayer",
    "sprayers",
    "skid steer",
    "skid steers",
    "excavator",
    "excavators",
    "header",
    "headers",
    "baler",
    "balers",
]


def _extract_category(query: str) -> str | None:
    q = query.lower()
    for cat in _KNOWN_CATEGORIES:
        if re.search(rf"\b{re.escape(cat)}\b", q):
            # Normalize to singular-ish canonical form for the param.
            return cat[:-1] if cat.endswith("s") and not cat.endswith("ss") else cat
    return None


# Common equipment makes, for cheap param extraction in the offline harness (the
# live agent extracts these via the model). Normalized to the make_norm form.
_KNOWN_MAKES = [
    "john deere",
    "case ih",
    "case",
    "new holland",
    "kinze",
    "bobcat",
    "kubota",
    "caterpillar",
    "claas",
    "fendt",
    "massey ferguson",
    "vermeer",
]


def _extract_make(query: str) -> str | None:
    q = query.lower()
    # Longest match first so "case ih" wins over "case".
    for make in sorted(_KNOWN_MAKES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(make)}\b", q):
            return make
    return None


def _extract_year_band(query: str) -> dict[str, int]:
    """Extract a model-year band. A single 4-digit year sets year_min==year_max."""
    years = [int(y) for y in re.findall(r"\b(?:19|20)\d{2}\b", query)]
    if not years:
        return {}
    return {"year_min": min(years), "year_max": max(years)}


def _extract_filters(query: str) -> dict[str, Any]:
    """Shared filter extraction for the aggregate templates (category/make/year)."""
    params: dict[str, Any] = {}
    category = _extract_category(query)
    if category:
        params["category"] = category
    make = _extract_make(query)
    if make:
        params["make"] = make
    params.update(_extract_year_band(query))
    return params


def _build_structured_call(query: str) -> ToolCall:
    """Construct a structured_query call bound to structured_query.schema.json."""
    template = _structured_template_for(query)
    params: dict[str, Any] = {}
    category = _extract_category(query)
    if category:
        params["category"] = category
    region_match = re.search(r"\bin\s+([A-Z][a-zA-Z]+)\b", query)
    if region_match and "region" not in params:
        params["region"] = region_match.group(1)
    return ToolCall(tool="structured_query", arguments={"template": template, "params": params})


def _build_realized_call(query: str) -> ToolCall:
    """Construct a realized_value (or realized_value_by_geo) structured_query call.

    Uses the trusted-numbers tool with the realized-value template — see
    Docs/specs/realized-value-template.md and geo-rollups-template.md.
    """
    params = _extract_filters(query)
    grain = _geo_grain(query)
    if grain:
        params["group_by"] = grain
        template = "realized_value_by_geo"
    else:
        template = "realized_value"
    return ToolCall(tool="structured_query", arguments={"template": template, "params": params})


def _build_demand_call(query: str) -> ToolCall:
    """Construct a demand_metrics structured_query call (aggregate counts only).

    See Docs/specs/demand-competition-template.md — NEVER bidder identity.
    """
    params = _extract_filters(query)
    return ToolCall(
        tool="structured_query", arguments={"template": "demand_metrics", "params": params}
    )


def route(
    query: str,
    *,
    top_k: int = 5,
    min_similarity: float = 0.0,
) -> RoutePlan:
    """Classify ``query`` into a RoutePlan per PRD §5.2.

    Decision order (a query may trigger both signals -> BOTH, the mixed case):
        comps signal only       -> Intent.COMPS       [comps_search]
        structured signal only  -> Intent.STRUCTURED  [structured_query]
        both signals            -> Intent.BOTH        [comps_search, structured_query]
        neither                 -> Intent.COMPS       (default: treat a bare
                                    equipment description as a comps request —
                                    the most common appraiser ask)

    Args:
        query: The natural-language appraiser question.
        top_k: comps_search fan-in (clamped by the schema's 1..50).
        min_similarity: comps_search confidence floor.

    Returns:
        A RoutePlan with the intent label, the ordered retrieval tool calls, and
        a short human-readable rationale.
    """
    if not query or not query.strip():
        return RoutePlan(intent=Intent.NONE, tool_calls=[], rationale="empty query")

    # P0/P2 specializations are checked BEFORE the generic comps/structured split:
    # realized-value and demand language is more specific (a realized-value ask
    # like "what does a consignor net... after fees" also trips generic structured
    # signals, so it must win first).
    if _has_realized(query):
        grain = _geo_grain(query)
        return RoutePlan(
            intent=Intent.REALIZED_VALUE,
            tool_calls=[_build_realized_call(query)],
            rationale=(
                "realized-value language -> structured_query realized_value"
                + ("_by_geo" if grain else "")
            ),
        )
    if _has_demand(query):
        return RoutePlan(
            intent=Intent.DEMAND,
            tool_calls=[_build_demand_call(query)],
            rationale="demand/competition language -> demand_metrics (aggregate counts only)",
        )

    has_comps = _has_comps(query)
    has_structured = _has_structured(query)

    if has_comps and has_structured:
        return RoutePlan(
            intent=Intent.BOTH,
            tool_calls=[
                _build_comps_call(query, top_k, min_similarity),
                _build_structured_call(query),
            ],
            rationale="query carries both comparable-lot and aggregate signals -> fuse both",
        )
    if has_structured:
        return RoutePlan(
            intent=Intent.STRUCTURED,
            tool_calls=[_build_structured_call(query)],
            rationale="aggregate/analytic language -> structured_query",
        )
    if has_comps:
        return RoutePlan(
            intent=Intent.COMPS,
            tool_calls=[_build_comps_call(query, top_k, min_similarity)],
            rationale="comparable-lot language -> comps_search",
        )
    # Default: a bare equipment description is treated as a comps request.
    return RoutePlan(
        intent=Intent.COMPS,
        tool_calls=[_build_comps_call(query, top_k, min_similarity)],
        rationale="no explicit aggregate signal; default equipment lookup -> comps_search",
    )
