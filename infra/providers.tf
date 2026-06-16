provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      # PoC convenience: do not block destroy if nested resources linger.
      prevent_deletion_if_contains_resources = false
    }
  }

  subscription_id = var.subscription_id
  # Auth: Terraform runs under the operator's PIM-activated identity OR a
  # dedicated Terraform service principal with OIDC federation.
  # Activate required PIM roles BEFORE `terraform plan` (8h window) — see README.
}

provider "azuread" {
  # Directory operations (app registrations) require Entra "Application
  # Administrator" — separate from subscription RBAC. If the operator lacks it,
  # have the client admin pre-create app registrations and feed their IDs in as
  # variables instead of letting Terraform manage them (set manage_app_regs=false).
  tenant_id = var.tenant_id
}
