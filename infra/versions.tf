# Terraform + provider version pins for the Lot Genius PoC.
# NOTE: azurerm_ai_foundry / azurerm_ai_foundry_project require azurerm >= 4.x.
#       If your environment is pinned to azurerm 3.x, provision the Foundry
#       account/project with the azapi provider instead (see foundry.tf TODO).

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.20"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
