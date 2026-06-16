output "resource_group" {
  value = local.rg_name
}

output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.pg.fqdn
}

output "postgres_database" {
  value = azurerm_postgresql_flexible_server_database.appdb.name
}

output "mcp_server_url" {
  value       = "https://${azurerm_container_app.mcp.ingress[0].fqdn}"
  description = "MCP endpoint the Foundry orchestrator binds to (the seam)."
}

output "acr_login_server" {
  value = azurerm_container_registry.acr.login_server
}

output "workload_identity_client_id" {
  value = azurerm_user_assigned_identity.workload.client_id
}

output "foundry_project_id" {
  value = azurerm_ai_foundry_project.this.id
}

output "key_vault_uri" {
  value = azurerm_key_vault.kv.vault_uri
}
