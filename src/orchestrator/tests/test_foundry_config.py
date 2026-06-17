"""Config-seam tests for the deployable Foundry app.

Per QE-PLAN §2 (prod-client seams): "config-seam resolves endpoint/auth from
config, not hardcoded." We also assert there is NO shared-key path (PRD §8.1) —
auth is managed-identity only. These run without the Azure SDK installed.
"""

from __future__ import annotations

import dataclasses

import pytest

from lotgenius_orchestrator.foundry_app import (
    OrchestratorConfig,
    load_agent_definition,
)


def test_config_resolves_from_env(monkeypatch) -> None:
    monkeypatch.setenv("LOTGENIUS_PROJECT_ENDPOINT", "https://proj.example.net")
    monkeypatch.setenv("LOTGENIUS_MCP_SERVER_URL", "https://mcp.internal")
    monkeypatch.setenv("LOTGENIUS_INTENT_MODEL", "gpt-4o-mini")
    cfg = OrchestratorConfig.from_env()
    assert cfg.project_endpoint == "https://proj.example.net"
    assert cfg.mcp_server_url == "https://mcp.internal"
    assert cfg.intent_model_deployment == "gpt-4o-mini"


def test_config_requires_endpoints(monkeypatch) -> None:
    monkeypatch.delenv("LOTGENIUS_PROJECT_ENDPOINT", raising=False)
    monkeypatch.delenv("LOTGENIUS_MCP_SERVER_URL", raising=False)
    with pytest.raises(RuntimeError):
        OrchestratorConfig.from_env()


def test_config_has_no_shared_key_field() -> None:
    """Managed identity only — there must be no shared-key/secret field (PRD §8.1)."""
    field_names = {f.name for f in dataclasses.fields(OrchestratorConfig)}
    forbidden = {"shared_key", "api_key", "function_key", "connection_string", "secret"}
    assert field_names.isdisjoint(forbidden), field_names


def test_intent_model_defaults_to_gpt_4o_mini(monkeypatch) -> None:
    monkeypatch.setenv("LOTGENIUS_PROJECT_ENDPOINT", "https://p")
    monkeypatch.setenv("LOTGENIUS_MCP_SERVER_URL", "https://m")
    monkeypatch.delenv("LOTGENIUS_INTENT_MODEL", raising=False)
    cfg = OrchestratorConfig.from_env()
    assert cfg.intent_model_deployment == "gpt-4o-mini"


def test_agent_definition_loads() -> None:
    definition = load_agent_definition()
    assert definition["name"] == "lotgenius-orchestrator"
    assert len(definition["tools"]) == 4
