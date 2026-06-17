# Lot Genius — Foundry Orchestrator (client-side deliverable)

The **thin orchestrator** Teams / M365 Copilot talks to. It does two things and
nothing else (PRD §5.1): **intent-classify** an appraiser query, then
**tool-call** the Lot Genius MCP seam. It owns no numbers of its own —
*vector finds the lots, SQL supplies the trusted numbers, `analyze` fuses + gates them.*

This is a **Deliverable** (everything on the client side of the MCP seam, PRD §9).
It consumes the four published MCP tool **contracts** and never vendors the Kadima
runtime.

## Layout

| Path | What | Deployable to Foundry? |
|------|------|------------------------|
| `agent/agent_definition.json` | Deployable Foundry Agent Service definition: system prompt, 4 MCP tool bindings (by contract schema), intent-routing policy, `gpt-4o-mini` intent model, **managed-identity** auth. | **Yes** — deployable artifact |
| `lotgenius_orchestrator/foundry_app.py` | Azure AI Agents/Projects SDK app: instantiates + runs the agent, auth to the MCP Container App over **managed identity** (PRD §8.1). Azure SDK imports are lazy; all Azure specifics behind `OrchestratorConfig` + `build_agent_client`. | **Yes** — needs Azure SDK + deployed MCP seam |
| `lotgenius_orchestrator/router.py` | The 3-way intent router (PRD §5.2). Pure function, no model, no DB — mirrors the gpt-4o-mini routing policy so it's auditable + offline-testable. | Logic mirrored; runs locally |
| `lotgenius_orchestrator/mcp_client.py` | MCP client seam: `MCPClient` (abstract), `StdioMCPClient` (live Rust seam over stdio), `MockMCPClient` (contract-shaped fixtures). | Seam; stdio is live, mock is local |
| `lotgenius_orchestrator/orchestrator.py` | The local agent loop: route → tool(s) → `analyze` fuse+gate → format. Enforces SC2. | **Locally simulated** |
| `harness.py` | Local test harness CLI — runs the loop with **no Azure**. | Local only |
| `fixtures/*.json` | Contract-shaped MCP responses: `money_shot`, `refusal`, `structured`, `both`. | Local only |
| `tests/` | pytest: router unit, local e2e (mocked MCP), contract conformance, config seam. | Local only |

## Deployable vs. locally-simulated

- **Deployable to Foundry:** `agent/agent_definition.json` + `foundry_app.py`.
  The agent runs in Steffes' tenant, routes with `gpt-4o-mini`, and reaches the
  MCP Container App over a managed identity.
- **Locally simulated (no Azure):** the whole agent loop via
  `Orchestrator` + `MockMCPClient`, driven by `harness.py` and the test suite.
  This is the QE-PLAN "local e2e (mocked MCP)" path.

## Auth — managed identity, never a shared key (PRD §8.1)

The orchestrator → MCP hop is **managed identity only**. `OrchestratorConfig`
has **no** field for a shared key / function key / connection string, and
`foundry_app._build_credential` constructs a `DefaultAzureCredential`
(system- or user-assigned MI). There is no key code path. A unit test
(`test_config_has_no_shared_key_field`) asserts this structurally.

## Run

```bash
python3.11 -m venv .venv && . .venv/bin/activate
pip install -e '.[test]'        # offline: pytest + jsonschema only

# Local harness (no Azure):
python harness.py "Show me 5 comps for a 2023 John Deere X9 1100"
python harness.py --scenario refusal "What's a 1974 widget reactor worth?"
python harness.py --scenario structured "What is the average price of combines?"
python harness.py --scenario both "How do recent X9 sales compare, and what's the average by region?"

# Against the live Rust seam over stdio (pending Brunel's runtime binary):
python harness.py --stdio /path/to/lotgenius-mcp "Show me comps for an X9 1100"
```

## Test

```bash
pip install -e '.[test]'
pytest -q
```

41 tests: router (21), local e2e mocked (7), contract conformance (8), config seam (5).

## Pending live wiring

Final end-to-end against the **live MCP runtime** waits on Brunel's Rust seam binary:

- `StdioMCPClient.connect()` — the concrete stdio handshake to the Rust seam.
- `foundry_app.create_orchestrator_agent()` — the live Foundry agent creation +
  MCP tool binding over MI (QE-PLAN gates F0–F2).

Until then, routing + fusion + formatting are fully exercised offline via
`MockMCPClient` against contract-shaped fixtures. The contract conformance tests
guarantee those fixtures match `contracts/*.schema.json`, so the swap to the live
seam is a drop-in.
