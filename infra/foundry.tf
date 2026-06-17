# Azure AI Foundry account + project, and the model deployments behind the seam.
#
# PROVIDER NOTE: azurerm_ai_foundry / azurerm_ai_foundry_project require azurerm
# >= 4.x. On older providers, create these with azapi (azapi_resource against
# Microsoft.CognitiveServices/accounts kind=AIServices + .../projects). The model
# DEPLOYMENTS below use azurerm_cognitive_deployment against the AI Services account.

# AI Foundry hub backing store. On azurerm >= 4.x the hub REQUIRES both a
# storage_account_id and a key_vault_id (key vault is in keyvault.tf). Storage
# account names are 3-24 chars, lowercase alphanumeric only — strip separators
# from prefix/suffix.
resource "azurerm_storage_account" "foundry" {
  name                     = substr(replace("${local.prefix}foundry${local.suffix}", "-", ""), 0, 24)
  resource_group_name      = local.rg_name
  location                 = local.rg_location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = local.tags
}

resource "azurerm_ai_foundry" "this" {
  name                = "${local.prefix}-foundry-${local.suffix}"
  resource_group_name = local.rg_name
  location            = local.rg_location
  storage_account_id  = azurerm_storage_account.foundry.id
  key_vault_id        = azurerm_key_vault.kv.id

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

resource "azurerm_ai_foundry_project" "this" {
  name               = "${local.prefix}-proj-${local.suffix}"
  location           = local.rg_location
  ai_services_hub_id = azurerm_ai_foundry.this.id

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

# ---- AI Services (Cognitive Services) account ----
# Model deployments MUST target a Cognitive Services account (kind=AIServices),
# NOT the Foundry hub. The custom_subdomain_name is required for token-based
# (managed-identity / AAD) data-plane auth against the OpenAI endpoints.
resource "azurerm_cognitive_account" "aiservices" {
  name                  = "${local.prefix}-aisvc-${local.suffix}"
  resource_group_name   = local.rg_name
  location              = local.rg_location
  kind                  = "AIServices"
  sku_name              = "S0"
  custom_subdomain_name = "${local.prefix}-aisvc-${local.suffix}"

  identity {
    type = "SystemAssigned"
  }

  tags = local.tags
}

# ---- Model deployments ----
# These deploy onto the AI Services account above. SKU is GlobalStandard for all
# three (verified against the live account — every working deployment is
# GlobalStandard; the scaffold's "Standard" was wrong).

resource "azurerm_cognitive_deployment" "embedding" {
  name                 = "embeddings"
  cognitive_account_id = azurerm_cognitive_account.aiservices.id
  model {
    format = "OpenAI"
    name   = var.embedding_model # text-embedding-3-large (3072-dim)
    # CONFIRM AT APPLY: this is the current catalog version for
    # text-embedding-3-large. Verify with:
    #   az cognitiveservices account list-models -g <rg> -n <aisvc> \
    #     --query "[?name=='text-embedding-3-large'].version"
    version = "1"
  }
  sku {
    name     = "GlobalStandard"
    capacity = 50
  }
}

resource "azurerm_cognitive_deployment" "intent" {
  name                 = "intent"
  cognitive_account_id = azurerm_cognitive_account.aiservices.id
  model {
    format  = "OpenAI"
    name    = var.intent_model # gpt-4o-mini
    version = "2024-07-18"
  }
  sku {
    name     = "GlobalStandard"
    capacity = 30
  }
}

# Reasoning model behind the `analyze` tool. Stopgap = gpt-5 (var.reasoning_model);
# MAI-Thinking-1 is not GA/deployable, so this is a 1-line swap via the variable.
resource "azurerm_cognitive_deployment" "reasoning" {
  name                 = "reasoning"
  cognitive_account_id = azurerm_cognitive_account.aiservices.id
  model {
    format  = "OpenAI"
    name    = var.reasoning_model # gpt-5
    version = "2025-08-07"
  }
  sku {
    name     = "GlobalStandard"
    capacity = 20
  }
}
