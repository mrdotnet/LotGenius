"""The local agent loop: query -> route -> MCP tool(s) -> analyze -> answer.

This mirrors what the deployed Foundry agent does (PRD §5.1) but runs entirely
offline against an MCPClient, so the QE-PLAN "local e2e (mocked MCP)" path is
fully exercisable now.

Critical safety property (SC2, QE-PLAN §1 Q-FAB / Q-REFUSE):
    - Every number in the formatted answer must trace to a Lot ID returned by a
      tool. We NEVER synthesize a price the tools did not return.
    - When ``analyze`` sets ``escalate: true`` (below the confidence floor), the
      answer is a refusal — "no good comps" — never a fabricated number.

The orchestrator does not narrate with an LLM here; ``analyze`` (MAI-Thinking-1
behind the seam) owns the answer text. Locally, the mock's analyze fixture
supplies that text, and the formatter only *carries it through* with citations
appended. Per QE-PLAN we do not gate on narration prose — we gate on the
decision tuple (escalate, citations).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .identity import CallerIdentity
from .mcp_client import MCPClient
from .router import Intent, RoutePlan, route


@dataclass
class Answer:
    """The orchestrator's formatted result for an appraiser query.

    Attributes:
        text:        Human-readable answer (carried through from ``analyze``),
                     or a refusal string when escalated.
        escalated:   True when ``analyze`` refused (below confidence floor).
        citations:   Lot IDs backing every number stated (SC2 traceability).
        intent:      The routing decision that produced this answer.
        receipt:     The classification receipt from ``analyze`` (auditable).
        tool_calls:  Names of the retrieval tools actually dispatched.
        consignor:   Optional consignor block from ``analyze``. PII — the seam
                     redacts every leaf to ``[REDACTED]`` for a caller without
                     ``can_see_pii`` (Item 3), so this carries the headline PII
                     differential straight through to the answer. ``None`` when
                     the analyze result carried no consignor field.
    """

    text: str
    escalated: bool
    citations: list[int] = field(default_factory=list)
    intent: Intent = Intent.NONE
    receipt: dict[str, Any] = field(default_factory=dict)
    tool_calls: list[str] = field(default_factory=list)
    consignor: dict[str, Any] | None = None


# Surfaced verbatim when analyze escalates. Carries the "confident refusal beats
# a fabricated number" bet (QE-PLAN §9).
REFUSAL_TEXT = (
    "I don't have good comparable sales for that, so I won't put a number on it. "
    "Escalating to a human appraiser."
)


class Orchestrator:
    """Thin orchestrator: intent-route, tool-call, fuse via analyze, format."""

    def __init__(self, mcp: MCPClient) -> None:
        self.mcp = mcp

    def answer(
        self,
        query: str,
        *,
        top_k: int = 5,
        min_similarity: float = 0.0,
        scenario: str | None = None,
        caller: CallerIdentity | None = None,
    ) -> Answer:
        """Run the full local agent loop for ``query`` on behalf of ``caller``.

        Args:
            query: The appraiser's natural-language question.
            top_k: comps_search fan-in.
            min_similarity: comps_search confidence floor.
            scenario: For MockMCPClient — which fixture scenario to answer from.
                      Ignored by live clients.
            caller: The signed-in user the query is asked for. Threaded onto
                    EVERY MCP call so the seam resolves ABAC permissions and
                    enforces the field-level PII gate (Item 3/4). ``None`` ==
                    anonymous (the seam applies the default ``basic`` group).

        Returns:
            An Answer carrying the analyze decision (escalate + citations) and a
            formatted text that never invents a number the tools did not return.
        """
        # Let the mock serve the right scenario fixture (no-op for live clients).
        if scenario is not None and hasattr(self.mcp, "scenario"):
            self.mcp.scenario = scenario  # type: ignore[attr-defined]

        plan: RoutePlan = route(query, top_k=top_k, min_similarity=min_similarity)

        comps: list[dict[str, Any]] = []
        facts: list[dict[str, Any]] = []

        # 1. Dispatch the retrieval tools the router chose.
        for call in plan.tool_calls:
            result = self.mcp.call_tool(call.tool, call.arguments, caller=caller)
            if call.tool == "comps_search":
                comps = result.get("comps", [])
                # If the seam flagged low confidence, we still hand it to
                # analyze, which owns the escalate decision. We do not fabricate.
            elif call.tool == "structured_query":
                facts = result.get("rows", [])

        # 2. Fuse + gate via analyze (MAI-Thinking-1 behind the seam).
        #
        # The runtime's analyze does its OWN retrieval when retrieval results are
        # not supplied, and that is the self-citing path. Passing an *empty*
        # comps/facts list signals "the caller already fused, cite nothing" and
        # suppresses the runtime's retrieval — which would drop our citations.
        # So we only forward comps/facts when we actually have rows; otherwise we
        # let analyze retrieve and cite. (Confirmed against the wired Rust seam:
        # analyze(query) cites lot_ids; analyze(query, facts=[]) cites nothing.)
        analyze_args: dict[str, Any] = {"query": query}
        if comps:
            analyze_args["comps"] = comps
        if facts:
            analyze_args["facts"] = facts
        analysis = self.mcp.call_tool("analyze", analyze_args, caller=caller)

        escalate = bool(analysis.get("escalate", False))
        receipt = analysis.get("classification_receipt", {})
        citations = list(analysis.get("citations", []) or [])
        # Consignor PII rides through verbatim. The seam already redacted it to
        # [REDACTED] unless the caller can_see_pii (Item 3) — we never re-derive
        # the policy here, we only carry whatever the boundary chose to release.
        consignor = analysis.get("consignor")

        # 3. Format — refusal surfaces as "no good comps", never a number.
        if escalate:
            return Answer(
                text=REFUSAL_TEXT,
                escalated=True,
                citations=[],
                intent=plan.intent,
                receipt=receipt,
                tool_calls=plan.tools,
            )

        text = analysis.get("answer") or ""
        text = self._format_answer(text, citations, plan.intent)
        return Answer(
            text=text,
            escalated=False,
            citations=citations,
            intent=plan.intent,
            receipt=receipt,
            tool_calls=plan.tools,
            consignor=consignor,
        )

    @staticmethod
    def _format_answer(
        answer_text: str, citations: list[int], intent: Intent = Intent.COMPS
    ) -> str:
        """Carry the analyze answer through, appending Lot-ID citations (SC2).

        We never rewrite the numbers; we only attach the provenance trail so the
        appraiser can trace every figure to a lot. If a *comps* answer comes back
        with no citations, that is a fabrication risk — we surface a provenance
        warning rather than present an uncited priced answer.

        Aggregate answers are different: a STRUCTURED query is traceable by
        year / row-count over source rows (every figure IS a SQL aggregate), not
        by individual lot_id. The runtime already states this, so the
        "unverified" footer is wrong there and we suppress it — it only fires for
        the genuine orphan case (a comps answer with a figure but no citations).

        Args:
            answer_text: The answer text from analyze.
            citations: Lot IDs backing the answer (empty for aggregate answers).
            intent: The routed intent — controls the no-citation footer. For
                Intent.STRUCTURED the footer is suppressed (aggregate provenance);
                otherwise an uncited answer gets the unverified warning.
        """
        if citations:
            cite_str = ", ".join(f"Lot {lot_id}" for lot_id in citations)
            return f"{answer_text}\n\nSources: {cite_str}.".strip()

        # No lot-level citations. For an aggregate (structured) answer this is
        # expected and correct — provenance is the SQL aggregate, not a lot_id —
        # so we pass the answer through untouched.
        if intent == Intent.STRUCTURED:
            return answer_text.strip()

        # Genuine orphan: a comps-style answer with a figure but no citation.
        return (
            f"{answer_text}\n\n"
            "(No Lot-ID citations were returned for this answer — treat any "
            "figures as unverified.)"
        ).strip()
