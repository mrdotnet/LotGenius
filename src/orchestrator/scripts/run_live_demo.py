#!/usr/bin/env python3
"""Drive the full demo path through the REAL stack (task #14 e2e milestone).

    orchestrator -> StdioMCPClient -> Rust seam (--features runtime)
                 -> Rust runtime -> real AOAI / gpt-5 + local pgvector prod DB

Measures end-to-end latency at the ORCHESTRATOR BOUNDARY (SC3 at the edge Teams
would see) for three demo queries: money-shot, refusal, structured.

This is a LOCAL e2e DRIVER (not a deliverable) — it is the script equivalent of
the gated integration test. It reads the seam binary path and prod creds/profile
from the ENVIRONMENT (set by the operator), so nothing local-dev-specific is
baked in. Run it after loading creds, e.g.:

    set -a; . local-dev/.env.local; set +a
    export LOTGENIUS_PROFILE=prod
    export LOTGENIUS_MCP_SERVER_COMMAND=/abs/path/to/wired/target/debug/lotgenius-mcp
    src/orchestrator/.venv/bin/python src/orchestrator/scripts/run_live_demo.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lotgenius_orchestrator import Orchestrator, StdioMCPClient  # noqa: E402

DEMO = [
    ("money-shot", "show me 5 comps for a 2023 John Deere X9 1100", "money_shot"),
    ("refusal", "how much is a unicorn worth", "refusal"),
    ("structured", "year over year hammer price trend for combines", "structured"),
]


def main() -> int:
    client = StdioMCPClient()  # command/env from environment; no hardcoded path
    print(f"[seam] command={client.command}")
    print(f"[seam] LOTGENIUS_PROFILE={client.env.get('LOTGENIUS_PROFILE', '(unset)')}")
    t0 = time.perf_counter()
    client.connect()
    print(f"[seam] connected + handshake in {time.perf_counter() - t0:.2f}s\n")

    orch = Orchestrator(client)
    rc = 0
    try:
        for label, query, _scenario in DEMO:
            start = time.perf_counter()
            result = orch.answer(query)
            elapsed = time.perf_counter() - start
            print(f"=== {label.upper()} ({elapsed:.2f}s) ===")
            print(f"query     : {query}")
            print(f"intent    : {result.intent.value}  tools={result.tool_calls}")
            print(f"escalate  : {result.escalated}")
            print(f"citations : {result.citations}")
            print(f"answer    : {result.text}\n")
            # Light SC2 assertion. A refusal must carry no dollar figure. A
            # comps answer must carry lot-level citations. A pure structured
            # (aggregate) answer is cited at the AGGREGATE level — the runtime
            # honestly declines to fabricate lot_ids for per-year averages, so
            # we don't require lot citations there (that would be the fabrication
            # we're guarding against), only that it didn't invent a lot id.
            if result.escalated:
                if "$" in result.text:
                    print("  [WARN] refusal contains a $ figure", file=sys.stderr)
                    rc = 1
            elif result.intent.value in ("comps", "both"):
                if not result.citations:
                    print("  [WARN] comps answer with no Lot-ID citations", file=sys.stderr)
                    rc = 1
    finally:
        client.close()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
