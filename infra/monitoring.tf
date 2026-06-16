# Application Insights for the MCP server + Foundry agent.
#
# IP GUARDRAIL (see PRD §9.5): keep trace/telemetry verbosity LOW so the
# framework's reasoning chains, prompts, and ReasoningBank internals do NOT land
# in client-readable logs in plaintext. Sampling + scrubbed log levels below.

resource "azurerm_application_insights" "appi" {
  name                = "${local.prefix}-appi-${local.suffix}"
  resource_group_name = local.rg_name
  location            = local.rg_location
  workspace_id        = azurerm_log_analytics_workspace.law.id
  application_type    = "web"
  sampling_percentage = 20 # reduce volume; tune at workshop
  tags                = local.tags
}

# NOTE: enforce log-level scrubbing in the MCP server app config (not Terraform):
#   - log level = WARNING for framework-internal modules
#   - never log full prompt / chain-of-thought / retrieved episodes
#   - redact tool arguments containing query text if policy requires
