"""Deployable Foundry orchestrator app (Azure AI Agents/Projects SDK pattern).

This is the *client-side deliverable* that instantiates and runs the thin agent
in Steffes' tenant. It authenticates to the MCP Container App endpoint over
MANAGED IDENTITY (PRD §8.1) — never a shared key.

Design constraint (task brief): keep Azure specifics behind a small client seam
so it's configurable. All Azure objects are constructed in one place
(`build_agent_client`) from `OrchestratorConfig`, and the Azure SDK imports are
lazy so this module imports cleanly (and unit tests run) without the Azure SDK
installed. The offline agent loop lives in orchestrator.py / mcp_client.py and
does NOT import anything from here.

Deployable vs. simulated:
    - This module  -> deployable to Foundry Agent Service (needs Azure SDK +
                      a deployed MCP Container App + a managed identity).
    - orchestrator.py + MockMCPClient -> locally simulated (no Azure).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

AGENT_DEFINITION_PATH = Path(__file__).resolve().parent.parent / "agent" / "agent_definition.json"


@dataclass
class OrchestratorConfig:
    """Config for the deployed orchestrator. Resolved from env, never hardcoded.

    Auth is managed-identity-only (PRD §8.1): there is deliberately NO field for
    a shared key or connection string with an embedded secret. The MCP endpoint
    is reached with a DefaultAzureCredential / ManagedIdentityCredential token.
    """

    project_endpoint: str
    """Azure AI Foundry project endpoint (the Agents/Projects SDK target)."""

    mcp_server_url: str
    """HTTPS URL of the MCP Container App (the seam). Reached over MI."""

    intent_model_deployment: str = "gpt-4o-mini"
    """Deployment name of the small/fast intent-routing model (PRD §5.3)."""

    managed_identity_client_id: str | None = None
    """User-assigned MI client id. None => system-assigned identity."""

    @classmethod
    def from_env(cls) -> OrchestratorConfig:
        """Build config from environment variables (12-factor; no secrets in code).

        Required:
            LOTGENIUS_PROJECT_ENDPOINT
            LOTGENIUS_MCP_SERVER_URL
        Optional:
            LOTGENIUS_INTENT_MODEL          (default: gpt-4o-mini)
            LOTGENIUS_MI_CLIENT_ID          (user-assigned MI; else system-assigned)
        """
        try:
            project_endpoint = os.environ["LOTGENIUS_PROJECT_ENDPOINT"]
            mcp_server_url = os.environ["LOTGENIUS_MCP_SERVER_URL"]
        except KeyError as exc:
            raise RuntimeError(f"missing required env var: {exc}") from exc
        return cls(
            project_endpoint=project_endpoint,
            mcp_server_url=mcp_server_url,
            intent_model_deployment=os.environ.get("LOTGENIUS_INTENT_MODEL", "gpt-4o-mini"),
            managed_identity_client_id=os.environ.get("LOTGENIUS_MI_CLIENT_ID"),
        )


def load_agent_definition() -> dict[str, Any]:
    """Load the Foundry agent definition (system prompt + tool bindings + policy)."""
    return json.loads(AGENT_DEFINITION_PATH.read_text())


def _build_credential(config: OrchestratorConfig):
    """Construct the managed-identity credential (PRD §8.1 — never a shared key).

    Lazy import so the package imports without azure-identity installed.
    DefaultAzureCredential picks up the Container App's managed identity at
    runtime; locally it falls back to az-cli/developer creds, but NEVER to a
    shared key — there is no key path in this code.
    """
    from azure.identity import DefaultAzureCredential  # type: ignore

    if config.managed_identity_client_id:
        return DefaultAzureCredential(
            managed_identity_client_id=config.managed_identity_client_id
        )
    return DefaultAzureCredential()


def build_agent_client(config: OrchestratorConfig):
    """Instantiate the Azure AI Agents client over managed identity.

    This is the single Azure seam. Returns an AIProjectClient ready to create /
    run the orchestrator agent. Requires `azure-ai-projects` + `azure-identity`.

    Wiring note: creating the agent with its MCP tool bindings and running a
    conversation turn is the live e2e path; it is gated on a deployed MCP
    Container App + the 3 managed-identity hops (QE-PLAN F2). Until that target
    exists, exercise the loop locally via Orchestrator + MockMCPClient.
    """
    from azure.ai.projects import AIProjectClient  # type: ignore

    credential = _build_credential(config)
    return AIProjectClient(endpoint=config.project_endpoint, credential=credential)


def create_orchestrator_agent(client, config: OrchestratorConfig):
    """Create the Foundry agent from agent_definition.json with MCP tool bindings.

    The four MCP tools are bound by pointing the agent at the MCP server URL
    (reached over MI); the agent's tool list and routing policy come from the
    agent definition. Concrete SDK calls depend on the installed SDK version, so
    this is the documented integration point rather than a hardcoded call that
    could drift from the SDK.
    """
    definition = load_agent_definition()
    # pragma: no cover - requires a live Foundry project + Azure SDK.
    raise NotImplementedError(
        "create_orchestrator_agent is the live Foundry wiring point. It binds "
        f"{len(definition['tools'])} MCP tools at {config.mcp_server_url} over "
        "managed identity. Wire against a deployed MCP Container App (QE-PLAN "
        "F0-F2). For offline testing use Orchestrator + MockMCPClient."
    )
