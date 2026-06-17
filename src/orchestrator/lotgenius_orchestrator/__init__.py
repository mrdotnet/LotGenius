"""Lot Genius Foundry orchestrator (client-side deliverable).

Thin intent-classify + tool-calling layer per PRD §5.1. This package is the
*Deliverable* side of the MCP seam — it consumes the four published MCP tool
contracts and never vendors the Kadima runtime (PRD §9).

Public surface:
    route(query)            -> RoutePlan        (the 3-way intent decision)
    MCPClient               (abstract seam to the MCP server)
    StdioMCPClient          (talks to the local Rust seam over stdio)
    MockMCPClient           (contract-shaped fixtures; no Azure, no runtime)
    Orchestrator.answer()   (the full local agent loop)
"""

from .mcp_client import MCPClient, MockMCPClient, StdioMCPClient
from .orchestrator import Answer, Orchestrator
from .router import Intent, RoutePlan, ToolCall, route

__all__ = [
    "Intent",
    "RoutePlan",
    "ToolCall",
    "route",
    "MCPClient",
    "MockMCPClient",
    "StdioMCPClient",
    "Orchestrator",
    "Answer",
]
