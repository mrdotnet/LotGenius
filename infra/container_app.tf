# Container Apps: the MCP server (the seam) + the embedding/ETL job.
#
# IP NOTE: the MCP server image is the Kadima agentic-AI-framework runtime and is
# Background IP. Per the PoC decision it is hosted in the Steffes subscription
# UNDER A MUTUAL USAGE AGREEMENT; ship it as a BUILT IMAGE (no source in the
# image) and keep its telemetry verbosity scrubbed (see monitoring.tf).

resource "azurerm_user_assigned_identity" "workload" {
  name                = "${local.prefix}-id-${local.suffix}"
  resource_group_name = local.rg_name
  location            = local.rg_location
  tags                = local.tags
}

resource "azurerm_container_registry" "acr" {
  name                = replace("${local.prefix}acr${local.suffix}", "-", "")
  resource_group_name = local.rg_name
  location            = local.rg_location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

resource "azurerm_log_analytics_workspace" "law" {
  name                = "${local.prefix}-law-${local.suffix}"
  resource_group_name = local.rg_name
  location            = local.rg_location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_container_app_environment" "cae" {
  name                       = "${local.prefix}-cae-${local.suffix}"
  resource_group_name        = local.rg_name
  location                   = local.rg_location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.law.id
  tags                       = local.tags
}

# ---- The MCP server (the seam) ----
resource "azurerm_container_app" "mcp" {
  name                         = "${local.prefix}-mcp-${local.suffix}"
  container_app_environment_id = azurerm_container_app_environment.cae.id
  resource_group_name          = local.rg_name
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.workload.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.workload.id
  }

  template {
    min_replicas = 1
    # Single replica: the seam's streamable-HTTP session manager is in-memory per replica,
    # so MCP sessions must not be split across replicas (PoC scope; add ingress session
    # affinity or a shared session store before scaling out).
    max_replicas = 1

    container {
      name   = "mcp-server"
      image  = "${azurerm_container_registry.acr.login_server}/lotgenius-mcp:latest"
      cpu    = 0.5
      memory = "1Gi"

      # Select the streamable-HTTP transport on :8080 (default binary transport is stdio).
      # Foundry reaches /mcp over managed identity (PRD §5.1/§8.1).
      env {
        name  = "LOTGENIUS_HTTP_ADDR"
        value = "0.0.0.0:8080"
      }

      # ---- Runtime: prod profile against the Azure data planes over managed identity ----
      # No secrets/keys — the workload MI (AZURE_CLIENT_ID) mints tokens for Postgres
      # (oss-rdbms) and Azure OpenAI (cognitiveservices) at runtime. structured_query reads
      # the authoritative numbers from curated_lots in Postgres (mirrored from Synapse by the
      # embed job), so the seam needs no live Synapse connection.
      env {
        name  = "LOTGENIUS_PROFILE"
        value = "prod"
      }
      env {
        name  = "LOTGENIUS_PG_AZURE"
        value = "1"
      }
      env {
        name  = "PGHOST"
        value = azurerm_postgresql_flexible_server.pg.fqdn
      }
      env {
        name  = "PGDATABASE"
        value = azurerm_postgresql_flexible_server_database.appdb.name
      }
      env {
        name  = "PGUSER"
        value = azurerm_user_assigned_identity.workload.name
      }
      env {
        name  = "PGPORT"
        value = "5432"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.workload.client_id
      }
      env {
        name  = "AOAI_ENDPOINT"
        value = "https://${azurerm_cognitive_account.aiservices.custom_subdomain_name}.openai.azure.com"
      }
      env {
        name  = "AOAI_EMBED_DEPLOYMENT"
        value = azurerm_cognitive_deployment.embedding.name
      }
      env {
        name  = "AOAI_REASONING_DEPLOYMENT"
        value = azurerm_cognitive_deployment.reasoning.name
      }
      env {
        name  = "AOAI_API_VERSION"
        value = "2025-04-01-preview" # gpt-5 needs a recent version (max_completion_tokens)
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

# ---- Embedding / ETL job: Synapse -> Azure OpenAI embeddings -> pgvector ----
# Opt-in: ARM validates the image at create time, so this can only be applied once the
# ETL image `lotgenius-embed:latest` is built & pushed to ACR (Background-IP/ETL artifact,
# delivered separately like the runtime image). Flip var.deploy_embed_job=true then apply.
resource "azurerm_container_app_job" "embed" {
  count                        = var.deploy_embed_job ? 1 : 0
  name                         = "${local.prefix}-embed-${local.suffix}"
  container_app_environment_id = azurerm_container_app_environment.cae.id
  resource_group_name          = local.rg_name
  location                     = local.rg_location
  replica_timeout_in_seconds   = 1800
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.workload.id]
  }

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  template {
    container {
      name   = "embed"
      image  = "${azurerm_container_registry.acr.login_server}/lotgenius-embed:latest" # TODO
      cpu    = 1.0
      memory = "2Gi"
      env {
        name  = "EMBEDDING_DEPLOYMENT"
        value = azurerm_cognitive_deployment.embedding.name
      }
      env {
        name  = "PG_FQDN"
        value = azurerm_postgresql_flexible_server.pg.fqdn
      }
    }
  }
}
