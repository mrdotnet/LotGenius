# Azure AI Foundry account + project, and the model deployments behind the seam.
#
# PROVIDER NOTE: azurerm_ai_foundry / azurerm_ai_foundry_project require azurerm
# >= 4.x. On older providers, create these with azapi (azapi_resource against
# Microsoft.CognitiveServices/accounts kind=AIServices + .../projects). The model
# DEPLOYMENTS below use azurerm_cognitive_deployment against the AI Services account.

resource "azurerm_ai_foundry" "this" {
  name                = "${local.prefix}-foundry-${local.suffix}"
  resource_group_name = local.rg_name
  location            = local.rg_location
  storage_account_id  = null # TODO: associate a storage account if required by provider version
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

# ---- Model deployments ----
# These deploy onto the AI Services / Azure OpenAI account underpinning Foundry.
# TODO: confirm the account resource id exposed by your provider version; some
# versions deploy against azurerm_ai_services / azurerm_cognitive_account.

resource "azurerm_cognitive_deployment" "embedding" {
  name                 = "embeddings"
  cognitive_account_id = azurerm_ai_foundry.this.id # TODO: may need the underlying AI Services account id
  model {
    format  = "OpenAI"
    name    = var.embedding_model # text-embedding-3-large
    version = null                # pin at workshop; dimension is a tunable knob
  }
  sku {
    name     = "Standard"
    capacity = 50
  }
}

resource "azurerm_cognitive_deployment" "intent" {
  name                 = "intent"
  cognitive_account_id = azurerm_ai_foundry.this.id
  model {
    format = "OpenAI"
    name   = var.intent_model # gpt-4o-mini class
  }
  sku {
    name     = "Standard"
    capacity = 30
  }
}

# MAI-Thinking-1 — reasoning model from the MS Build MAI launch. Availability via
# the Foundry model catalog (serverless / managed). TODO: confirm deployment shape
# (azurerm_cognitive_deployment vs Foundry serverless endpoint) at build time.
resource "azurerm_cognitive_deployment" "reasoning" {
  name                 = "reasoning"
  cognitive_account_id = azurerm_ai_foundry.this.id
  model {
    format = "OpenAI" # TODO: confirm format/publisher for MAI models
    name   = var.reasoning_model
  }
  sku {
    name     = "Standard"
    capacity = 20
  }
}
