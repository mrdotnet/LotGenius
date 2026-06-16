locals {
  prefix = var.name_prefix
  # Globally-unique-ish suffix so names don't collide on re-create.
  suffix      = random_string.suffix.result
  rg_name     = var.create_resource_group ? azurerm_resource_group.this[0].name : var.resource_group_name
  rg_location = var.location
  tags        = var.tags
}

resource "random_string" "suffix" {
  length  = 5
  special = false
  upper   = false
}

resource "azurerm_resource_group" "this" {
  count    = var.create_resource_group ? 1 : 0
  name     = var.resource_group_name
  location = var.location
  tags     = local.tags
}

data "azurerm_resource_group" "existing" {
  count = var.create_resource_group ? 0 : 1
  name  = var.resource_group_name
}

# ---- References to EXISTING Steffes assets (read-only; NOT created here) ----
# Synapse curated views and the Blob 'tuning/' container already exist. Data-plane
# access (Synapse GRANT SELECT, Postgres Entra admin login) is configured OUT OF
# BAND — control-plane Contributor does not grant it. See README §"Out-of-band".
#
# Example (uncomment + fill once names are confirmed at the discovery workshop):
# data "azurerm_storage_account" "tuning" {
#   name                = "<existing tuning storage account>"
#   resource_group_name = "rg-steffes-copilot"
# }
