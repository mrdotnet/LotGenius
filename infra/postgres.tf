# Azure Database for PostgreSQL Flexible Server + pgvector.
#
# IMPORTANT two-step / two-plane gotcha:
#   1) `azure.extensions = VECTOR` is a SERVER PARAMETER (control plane) — set below.
#   2) `CREATE EXTENSION vector;` is a DATA-PLANE statement that must be run by an
#      Entra-admin SQL connection AFTER the server exists. Terraform cannot do (2)
#      via ARM — see the null_resource stub + README "Out-of-band steps".

resource "azurerm_postgresql_flexible_server" "pg" {
  name                          = "${local.prefix}-pg-${local.suffix}"
  resource_group_name           = local.rg_name
  location                      = local.rg_location
  version                       = var.pg_version
  sku_name                      = var.pg_sku_name
  storage_mb                    = var.pg_storage_mb
  auto_grow_enabled             = true
  public_network_access_enabled = true # PoC. Prefer private endpoint beyond PoC.

  # Entra-only auth (no SQL password). The operator/admins group logs in via Entra.
  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = false
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }
}

# (1) Allowlist the vector extension at the server-parameter level.
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.pg.id
  value     = "VECTOR"
}

resource "azurerm_postgresql_flexible_server_database" "appdb" {
  name      = "lotgenius"
  server_id = azurerm_postgresql_flexible_server.pg.id
  collation = "en_US.utf8"
  charset   = "utf8"
}

# Entra admin so DDL / CREATE EXTENSION / GRANTs can run. Prefer the Lot Genius
# Admins GROUP (with the operator a permanent member) to avoid PIM-for-Groups
# double-activation.
resource "azurerm_postgresql_flexible_server_active_directory_administrator" "admin" {
  server_name         = azurerm_postgresql_flexible_server.pg.name
  resource_group_name = local.rg_name
  tenant_id           = var.tenant_id
  object_id           = var.lot_genius_admins_group_object_id
  principal_name      = var.pg_admin_login
  principal_type      = "Group"
}

# Build-time operator access (tighten/remove beyond PoC).
resource "azurerm_postgresql_flexible_server_firewall_rule" "operator" {
  count            = var.allowed_client_ip == null ? 0 : 1
  name             = "operator-build"
  server_id        = azurerm_postgresql_flexible_server.pg.id
  start_ip_address = var.allowed_client_ip
  end_ip_address   = var.allowed_client_ip
}

# Allow Azure services (Container App / embedding job) to reach the server in PoC.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.pg.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# (2) DATA-PLANE bootstrap — STUB. Runs `CREATE EXTENSION vector` + schema.
# Requires an Entra token + psql on the runner. Left disabled by default; enable
# once the operator is a confirmed Entra admin/member. See db/schema.sql.
#
# resource "null_resource" "pgvector_bootstrap" {
#   depends_on = [
#     azurerm_postgresql_flexible_server_configuration.extensions,
#     azurerm_postgresql_flexible_server_active_directory_administrator.admin,
#     azurerm_postgresql_flexible_server_database.appdb,
#   ]
#   provisioner "local-exec" {
#     interpreter = ["/bin/bash", "-c"]
#     command = <<-EOT
#       export PGPASSWORD="$(az account get-access-token \
#         --resource-type oss-rdbms --query accessToken -o tsv)"
#       psql "host=${azurerm_postgresql_flexible_server.pg.fqdn} port=5432 \
#         dbname=lotgenius user=${var.pg_admin_login} sslmode=require" \
#         -f ${path.module}/db/schema.sql
#     EOT
#   }
# }
