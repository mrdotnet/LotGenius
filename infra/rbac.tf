# Role assignments wiring managed identities to data-plane services.
#
# REQUIRES: the deploying identity holds **Role Based Access Control Administrator**
# (or User Access Administrator) at the RG scope. Without it, every
# azurerm_role_assignment below fails — the classic Terraform-on-Azure wall.
#
# These are the WORKLOAD's runtime roles and should be PERMANENT (not PIM-eligible
# on the service principal) so the app doesn't break when an activation lapses.

# MCP server / job -> call Azure OpenAI (embeddings, intent, reasoning) at runtime.
# Scoped to the AI Services account that actually HOSTS the model deployments — an
# OpenAI User role on the Foundry hub would NOT grant data-plane access to them.
resource "azurerm_role_assignment" "workload_openai_user" {
  scope                = azurerm_cognitive_account.aiservices.id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = azurerm_user_assigned_identity.workload.principal_id
}

# MCP server -> use the Foundry project (agents/threads).
resource "azurerm_role_assignment" "workload_ai_developer" {
  scope                = azurerm_ai_foundry_project.this.id
  role_definition_name = "Azure AI Developer"
  principal_id         = azurerm_user_assigned_identity.workload.principal_id
}

# Workload -> pull the MCP/embed images from ACR.
resource "azurerm_role_assignment" "workload_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.workload.principal_id
}

# ---- OUT-OF-BAND data-plane grants Terraform cannot make (documented, not coded) ----
# 1) Synapse: GRANT SELECT / db_datareader on curated views to the workload MI and
#    the Lot Genius Admins group — issued by an existing Synapse SQL admin.
# 2) Postgres: the workload MI must be added as a Postgres role and granted on the
#    lotgenius schema (run via the Entra-admin connection; see db/schema.sql stub).
# 3) Blob 'tuning/' container: assign "Storage Blob Data Reader" to the workload MI
#    on the EXISTING storage account (uncomment once the account is referenced in main.tf):
#
# resource "azurerm_role_assignment" "workload_blob_reader" {
#   scope                = data.azurerm_storage_account.tuning.id
#   role_definition_name = "Storage Blob Data Reader"
#   principal_id         = azurerm_user_assigned_identity.workload.principal_id
# }
