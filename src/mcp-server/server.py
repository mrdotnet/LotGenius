"""
Lot Genius — MCP server (STUB / scaffold).

This is the SEAM (PRD §5.1) and the IP boundary (PRD §9). It publishes four typed
tools to the Microsoft Foundry orchestrator over MCP. The tool CONTRACTS (see
./contracts/*.schema.json) are Deliverables — the client-facing interface.

The IMPLEMENTATIONS delegate to Kadima's agentic AI framework, which is Background
IP and is NOT vendored here. In this repo the handlers are stubs that raise
NotImplementedError; the real handlers are provided by the framework runtime that
ships as a built container image.

Run (once the framework runtime is present):
    python server.py   # serves MCP over HTTP on :8080
"""
from __future__ import annotations
import json
import pathlib

# The MCP SDK provides the server/transport. (pip install mcp)
# from mcp.server.fastmcp import FastMCP

CONTRACTS_DIR = pathlib.Path(__file__).parent / "contracts"


def load_contract(name: str) -> dict:
    return json.loads((CONTRACTS_DIR / f"{name}.schema.json").read_text())


TOOLS = ["comps_search", "structured_query", "pii_scrub", "analyze"]


# --- Handlers: delegate to the framework runtime (Background IP, not in this repo) ---
def _framework():
    """Resolve the Kadima agentic-AI-framework runtime.

    Provided by the deployed container image, not by this repository. Kept behind
    this single accessor so the seam stays clean and the IP stays out of source.
    """
    try:
        import lotgenius_runtime  # type: ignore  # supplied by the built image
        return lotgenius_runtime.connect()
    except ImportError as exc:  # stub path — running without the runtime
        raise NotImplementedError(
            "Framework runtime not present. This repo ships tool CONTRACTS only; "
            "the implementation is delivered as a built image (PRD §9.4)."
        ) from exc


def handle_comps_search(args: dict) -> dict:
    return _framework().comps_search(**args)


def handle_structured_query(args: dict) -> dict:
    return _framework().structured_query(**args)


def handle_pii_scrub(args: dict) -> dict:
    return _framework().pii_scrub(**args)


def handle_analyze(args: dict) -> dict:
    return _framework().analyze(**args)


HANDLERS = {
    "comps_search": handle_comps_search,
    "structured_query": handle_structured_query,
    "pii_scrub": handle_pii_scrub,
    "analyze": handle_analyze,
}


def build_server():
    """Register the four contracts as MCP tools. Uncomment once `mcp` is installed."""
    # mcp = FastMCP("lot-genius")
    # for name in TOOLS:
    #     contract = load_contract(name)
    #     mcp.add_tool(
    #         name=contract["name"],
    #         description=contract["description"],
    #         input_schema=contract["inputSchema"],
    #         handler=HANDLERS[name],
    #     )
    # return mcp
    raise NotImplementedError("Install the `mcp` SDK and uncomment build_server().")


if __name__ == "__main__":
    # Smoke check: contracts load and every tool has a handler.
    for t in TOOLS:
        c = load_contract(t)
        assert c["name"] == t and t in HANDLERS, t
        print(f"contract OK: {t} — {c['title']}")
    print("\nThis is a scaffold. The framework runtime is delivered as a built image.")
