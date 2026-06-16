data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "kv" {
  name                      = replace("${local.prefix}-kv-${local.suffix}", "_", "-")
  resource_group_name       = local.rg_name
  location                  = local.rg_location
  tenant_id                 = var.tenant_id
  sku_name                  = "standard"
  enable_rbac_authorization = true # data-plane via RBAC, not access policies
  purge_protection_enabled  = false
  tags                      = local.tags
}

# The operator (deploying identity) needs Key Vault Administrator to write secrets.
resource "azurerm_role_assignment" "kv_admin_operator" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
}

# The workload identity reads secrets at runtime.
resource "azurerm_role_assignment" "kv_reader_workload" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.workload.principal_id
}
