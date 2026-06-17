#!/usr/bin/env python3
"""Local test harness — simulate the agent loop without Azure.

Takes an appraiser query, runs the intent router, calls the MCP tool(s) (mocked
by default, or the live Rust stdio seam when --stdio is given), and prints the
formatted answer with Lot-ID citations.

Examples:
    # Money-shot (answerable), against mocked MCP:
    python harness.py "Show me 5 comps for a 2023 John Deere X9 1100"

    # Refusal path (no good comps):
    python harness.py --scenario refusal "What's a 1974 widget reactor worth?"

    # Pure aggregate:
    python harness.py --scenario structured "What is the average price of combines?"

    # Mixed (both tools):
    python harness.py --scenario both "How do X9 sales compare, and the average by region?"

    # Against the live Rust seam over stdio (pending Brunel's runtime binary):
    python harness.py --stdio /path/to/lotgenius-mcp "Show me 5 comps for an X9 1100"

This is the QE-PLAN "local e2e (mocked MCP)" path: routing + fusion + formatting
fully exercised with no Azure, no live runtime.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lotgenius_orchestrator import (  # noqa: E402
    MCPClient,
    MockMCPClient,
    Orchestrator,
    StdioMCPClient,
    route,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Lot Genius orchestrator local harness")
    parser.add_argument("query", help="The appraiser's natural-language question")
    parser.add_argument(
        "--scenario",
        default="money_shot",
        help="Mock fixture scenario: money_shot | refusal | structured | both",
    )
    parser.add_argument(
        "--stdio",
        metavar="CMD",
        default=None,
        help="Path to the Rust MCP seam binary; use the live stdio client instead of the mock",
    )
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--min-similarity", type=float, default=0.0)
    args = parser.parse_args(argv)

    plan = route(args.query, top_k=args.top_k, min_similarity=args.min_similarity)
    print(f"[route] intent={plan.intent.value} tools={plan.tools}")
    print(f"[route] rationale: {plan.rationale}")

    client: MCPClient
    if args.stdio:
        client = StdioMCPClient(command=args.stdio)
        try:
            client.connect()
        except Exception as exc:  # noqa: BLE001
            print(f"[error] live seam unavailable: {exc}", file=sys.stderr)
            return 2
        orch = Orchestrator(client)
        result = orch.answer(args.query, top_k=args.top_k, min_similarity=args.min_similarity)
    else:
        client = MockMCPClient()
        orch = Orchestrator(client)
        result = orch.answer(
            args.query,
            top_k=args.top_k,
            min_similarity=args.min_similarity,
            scenario=args.scenario,
        )

    print(f"[result] escalated={result.escalated} citations={result.citations}")
    print("-" * 60)
    print(result.text)
    print("-" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
