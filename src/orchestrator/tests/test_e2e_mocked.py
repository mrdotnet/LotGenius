"""Local e2e (mocked MCP) — query -> routed tool call -> mocked response -> answer.

QE-PLAN §2 "one e2e (the money shot)" plus the refusal path, run entirely
offline against MockMCPClient with contract-shaped fixtures.

Asserts the load-bearing safety property SC2 / Q-FAB / Q-REFUSE:
    - Lot-ID citations are carried through into the answer.
    - A refusal (analyze escalate=true) surfaces as "no good comps", never a
      fabricated number.
"""

from __future__ import annotations

import re

from lotgenius_orchestrator import MockMCPClient, Orchestrator, demo_caller
from lotgenius_orchestrator.orchestrator import REFUSAL_TEXT
from lotgenius_orchestrator.router import Intent


def _orch() -> Orchestrator:
    return Orchestrator(MockMCPClient())


def test_money_shot_answers_with_lot_citations() -> None:
    """The money shot: 5 comps, an answer, and every figure traces to a Lot ID."""
    result = _orch().answer(
        "Show me 5 comps for a 2023 John Deere X9 1100", scenario="money_shot"
    )
    assert result.escalated is False
    assert result.intent == Intent.COMPS
    assert result.tool_calls == ["comps_search"]
    # Citations carried through exactly as analyze returned them (SC2).
    assert result.citations == [4412, 4380, 4501, 4290, 4188]
    # The Lot IDs appear in the formatted answer's provenance trail.
    for lot_id in result.citations:
        assert f"Lot {lot_id}" in result.text
    assert "Sources:" in result.text


def test_refusal_surfaces_as_no_good_comps_not_a_number() -> None:
    """Q-REFUSE: below-floor query escalates; answer carries NO price."""
    result = _orch().answer(
        "What's a 1974 widget reactor worth?", scenario="refusal"
    )
    assert result.escalated is True
    assert result.citations == []
    assert result.text == REFUSAL_TEXT
    # The refusal must not contain a fabricated dollar figure.
    assert "$" not in result.text
    assert not re.search(r"\d{3,}", result.text)


def test_refusal_receipt_is_low_confidence() -> None:
    """The escalation is auditable: the receipt shows below-floor confidence."""
    result = _orch().answer("obscure thing", scenario="refusal")
    assert result.receipt["confidence"] < 0.5
    assert result.receipt["reasoningbank_hit"] is False


def test_structured_query_answer_cites_underlying_lots() -> None:
    """Pure aggregate path: answer from structured_query, citing the lots behind it."""
    result = _orch().answer(
        "What is the average price of combines?", scenario="structured"
    )
    assert result.escalated is False
    assert result.intent == Intent.STRUCTURED
    assert result.tool_calls == ["structured_query"]
    assert result.citations  # aggregate still traces to lot_ids
    assert "Sources:" in result.text


def test_mixed_query_fuses_both_tools() -> None:
    """Mixed ask dispatches both retrieval tools, then analyze fuses them."""
    result = _orch().answer(
        "How do recent John Deere X9 sales compare, and what's the average by region?",
        scenario="both",
    )
    assert result.escalated is False
    assert result.intent == Intent.BOTH
    assert result.tool_calls == ["comps_search", "structured_query"]
    assert result.citations == [4412, 4380, 4501]
    for lot_id in result.citations:
        assert f"Lot {lot_id}" in result.text


def test_every_number_in_answer_traces_to_a_citation() -> None:
    """SC2 backbone: an answered (non-escalated) query must carry citations.

    We never present a priced answer with zero citations — the formatter flags
    it as unverified rather than passing an orphan number through.
    """
    cases = {
        "money_shot": "Show me 5 comps for a 2023 John Deere X9 1100",
        "structured": "What is the average price of combines?",
        "both": "How do recent X9 sales compare, and what's the average by region?",
    }
    for scenario, query in cases.items():
        result = _orch().answer(query, scenario=scenario)
        if not result.escalated:
            assert result.citations, f"{scenario}: answered with no citations"
            assert "unverified" not in result.text


def test_analyze_is_always_called_after_retrieval(monkeypatch) -> None:
    """analyze is the mandatory fuse+gate step on every non-empty query."""
    client = MockMCPClient()
    calls: list[str] = []
    original = client.call_tool

    def _spy(name: str, arguments: dict, *, caller=None):  # type: ignore[no-untyped-def]
        calls.append(name)
        return original(name, arguments, caller=caller)

    monkeypatch.setattr(client, "call_tool", _spy)
    Orchestrator(client).answer("Show me comps for an X9 1100", scenario="money_shot")
    assert calls[-1] == "analyze"
    assert "comps_search" in calls


def test_format_answer_flags_orphan_priced_number_without_citations() -> None:
    """F-2: a priced COMPS answer with NO citations surfaces the 'unverified' warning.

    Directly exercises the anti-fabrication guard branch in _format_answer: if
    analyze ever returns a number but no Lot-ID backing it on a comps path, the
    formatter must not present it as authoritative (SC2 / Q-FAB).
    """
    from lotgenius_orchestrator.orchestrator import Orchestrator as O

    text = O._format_answer("This combine is worth about $585,000.", [], Intent.COMPS)
    assert "unverified" in text
    assert "Sources:" not in text
    assert "$585,000" in text  # the orphan number is shown but explicitly flagged


def test_format_answer_suppresses_footer_for_structured_aggregate() -> None:
    """Structured/aggregate answers are traceable by year/row, not lot_id.

    A STRUCTURED answer with no lot citations is correct (every figure is a SQL
    aggregate over source rows), so the 'unverified' footer must NOT appear — it
    would undercut a legitimate aggregate answer.
    """
    from lotgenius_orchestrator.orchestrator import Orchestrator as O

    agg = "YoY average hammer price for combines rose from $87,250 (2010) to $259,438 (2020)."
    text = O._format_answer(agg, [], Intent.STRUCTURED)
    assert "unverified" not in text
    assert "Sources:" not in text  # no lot_ids to cite; aggregate provenance
    assert text == agg  # answer passed through untouched


def test_pii_differential_admin_sees_consignor_basic_redacted() -> None:
    """Item 4 headline: the SAME query, two callers, different PII visibility.

    The consignor block is released in cleartext only to a caller the seam
    resolves to can_see_pii (admin). basic/appraiser/anonymous get [REDACTED].
    This is the end-to-end proof that the caller threaded through the orchestrator
    drives the seam's field-level gate.
    """
    query = "Show me 5 comps for a 2023 John Deere X9 1100"

    admin = _orch().answer(query, scenario="money_shot", caller=demo_caller("admin").identity)
    assert admin.consignor is not None
    assert admin.consignor["consignor_name"] == "Dale Branton"
    assert admin.consignor["consignor_phone"] == "701-555-0142"

    basic = _orch().answer(query, scenario="money_shot", caller=demo_caller("basic").identity)
    assert basic.consignor is not None
    assert basic.consignor["consignor_name"] == "[REDACTED]"
    assert basic.consignor["consignor_phone"] == "[REDACTED]"

    appraiser = _orch().answer(
        query, scenario="money_shot", caller=demo_caller("appraiser").identity
    )
    assert appraiser.consignor is not None
    assert appraiser.consignor["consignor_name"] == "[REDACTED]"

    # Anonymous (no caller) falls back to the default basic group -> redacted.
    anon = _orch().answer(query, scenario="money_shot")
    assert anon.consignor is not None
    assert anon.consignor["consignor_name"] == "[REDACTED]"


def test_pii_differential_does_not_change_the_priced_answer() -> None:
    """Redaction is field-level: it gates consignor PII, not the comps/numbers.

    A basic caller still gets the full priced answer + Lot-ID citations — only the
    consignor identity is withheld. (The trusted numbers are not PII.)
    """
    query = "Show me 5 comps for a 2023 John Deere X9 1100"
    admin = _orch().answer(query, scenario="money_shot", caller=demo_caller("admin").identity)
    basic = _orch().answer(query, scenario="money_shot", caller=demo_caller("basic").identity)
    assert admin.text == basic.text
    assert admin.citations == basic.citations == [4412, 4380, 4501, 4290, 4188]


def test_format_answer_appends_sources_when_citations_present() -> None:
    """The happy-path counterpart to the orphan branch: citations -> Sources line."""
    from lotgenius_orchestrator.orchestrator import Orchestrator as O

    text = O._format_answer("Sold for $585,000.", [4412, 4380], Intent.COMPS)
    assert "Sources: Lot 4412, Lot 4380." in text
    assert "unverified" not in text


# --- P0 realized-value surfacing ---------------------------------------------


def test_realized_value_surfaces_net_and_all_in() -> None:
    """P0 headline: a realized-value ask returns the net-to-consignor + all-in-to-buyer line."""
    result = _orch().answer(
        "What does a consignor actually net on a John Deere X9 combine after fees?",
        scenario="realized_value",
    )
    assert result.escalated is False
    assert result.intent == Intent.REALIZED_VALUE
    assert result.tool_calls == ["structured_query"]
    # The trusted realized aggregate is surfaced as a structured block.
    assert result.realized_value is not None
    assert result.realized_value["net_to_consignor_avg"] == 498230.50
    # The deterministic realized-value line carries both perspectives + n.
    assert "consignor netted ~$498,230" in result.text
    assert "buyer paid ~$641,120 all-in" in result.text
    assert "n=38" in result.text
    # Aggregate provenance -> no orphan-number "unverified" footer.
    assert "unverified" not in result.text


def test_realized_value_line_is_deterministic_not_from_narration() -> None:
    """The figures come from the trusted template row, not from analyze prose."""
    from lotgenius_orchestrator.orchestrator import Orchestrator as O

    row = {
        "n": 12,
        "net_to_consignor_avg": 100000,
        "net_to_consignor_median": 95000,
        "all_in_to_buyer_avg": 130000,
    }
    text = O._append_realized_value("base.", row)
    assert "consignor netted ~$100,000 on average (median ~$95,000)" in text
    assert "buyer paid ~$130,000 all-in" in text
    assert "(n=12)" in text


def test_realized_value_omits_missing_figures() -> None:
    """We never invent a perspective the template did not return."""
    from lotgenius_orchestrator.orchestrator import Orchestrator as O

    text = O._append_realized_value("base.", {"n": 5, "net_to_consignor_avg": 50000})
    assert "consignor netted ~$50,000" in text
    assert "all-in" not in text  # buyer figure absent -> not fabricated


# --- P2 external-context narration (Bridge Protocol) -------------------------


def test_external_context_narrated_separately_with_provenance() -> None:
    """Context corroborates SEPARATELY from the trusted numbers, with provenance."""
    result = _orch().answer(
        "What does a consignor net on a John Deere X9 combine after fees?",
        scenario="realized_value",
    )
    assert len(result.context_notes) == 2
    # Each note carries the Bridge Protocol provenance.
    for note in result.context_notes:
        assert note["mechanism"]
        assert note["source"] in {"MachineryPete", "noaa", "crop_insurance", "ffiec"}
        assert note["region"] and note["period"]
    # Narrated under a clearly-separated, non-valuation heading.
    assert "Context (corroboration only — not a valuation):" in result.text
    assert "drought-driven herd liquidation" in result.text
    assert "source: MachineryPete" in result.text


def test_external_context_carries_no_standalone_valuation_number() -> None:
    """Bridge Protocol hard rule: context captions never assert a dollar figure."""
    result = _orch().answer(
        "What does a consignor net on a John Deere X9 combine after fees?",
        scenario="realized_value",
    )
    # Pull just the context block and assert no '$' figure leaked into a caption.
    context_block = result.text.split("Context (corroboration only")[1]
    for note in result.context_notes:
        assert "$" not in note["caption"]
    # The only dollar figures in the whole answer are the trusted realized ones.
    assert "$" in result.text  # realized line has them
    assert context_block.count("$") == 0


def test_append_context_drops_notes_missing_provenance() -> None:
    """provenance-or-no-render: a note without mechanism/source is not rendered."""
    from lotgenius_orchestrator.orchestrator import Orchestrator as O

    notes = [
        {"caption": "good note", "mechanism": "m", "source": "noaa"},
        {"caption": "no mechanism", "source": "noaa"},
        {"caption": "no source", "mechanism": "m"},
    ]
    text = O._append_context("base.", notes)
    assert "good note" in text
    assert "no mechanism" not in text
    assert "no source" not in text


def test_demand_metrics_surfaces_aggregate_counts() -> None:
    """P2 demand: aggregate bid/watch counts answered as trusted numbers, no PII."""
    result = _orch().answer(
        "How competitive is the bidding on John Deere combines?", scenario="demand"
    )
    assert result.escalated is False
    assert result.intent == Intent.DEMAND
    assert result.tool_calls == ["structured_query"]
    assert "96 distinct bidders" in result.text
    assert "unverified" not in result.text  # aggregate provenance
