variable "subscription_id" {
  type        = string
  description = "Steffes target subscription ID (Pay-As-You-Go, starts e1c620c2-…)."
}

variable "tenant_id" {
  type        = string
  description = "Steffes Entra tenant ID."
}

variable "location" {
  type        = string
  description = "Azure region for new resources."
  default     = "northcentralus" # Locked: build everything NEW in North Central US.
}

variable "resource_group_name" {
  type        = string
  description = "Target resource group. Existing rg-steffes-copilot, or a dedicated rg-steffes-lotgenius-poc for clean teardown."
  default     = "rg-steffes-lotgenius-poc"
}

variable "create_resource_group" {
  type        = bool
  description = "Create the RG (true) or use an existing one (false)."
  default     = true
}

variable "name_prefix" {
  type        = string
  description = "Short prefix for resource names."
  default     = "lotgenius"
}

variable "tags" {
  type = map(string)
  default = {
    project     = "lot-genius-poc"
    owner       = "kadima-consulting"
    environment = "poc"
    cost-center = "steffes"
  }
}

# ---- Identity / governance ----
variable "lot_genius_admins_group_object_id" {
  type        = string
  description = "Object ID of the Entra group set as Postgres Entra admin; granted Synapse SELECT out-of-band."
  # Default = the EXISTING Steffes admin group discovered in the legacy app
  # (ADMIN_GROUP_ID). Reused here as the PG Entra admin to avoid minting a new
  # group for the PoC. Override in terraform.tfvars to use a dedicated group.
  default = "19b73e33-283a-4379-af76-ae6308b439a0"
}

variable "deploy_embed_job" {
  type        = bool
  description = "Create the Synapse->embeddings->pgvector ETL job. Requires the ETL image lotgenius-embed:latest in ACR first (ARM validates the image at create). Leave false until that image is pushed."
  default     = false
}

variable "manage_app_regs" {
  type        = bool
  description = "Whether Terraform manages Entra app registrations (requires Application Administrator). If false, pass existing IDs."
  default     = false
}

# ---- Postgres ----
variable "pg_admin_login" {
  type        = string
  description = "Postgres Entra admin principal name (the admins group display name, or operator UPN for the stopgap)."
}

variable "pg_admin_principal_type" {
  type        = string
  description = "Entra admin principal type. 'Group' (default) when object_id is the Steffes admins group; flip to 'User' for the operator-UPN stopgap. Config flip, not a code edit."
  default     = "Group"

  validation {
    condition     = contains(["Group", "User", "ServicePrincipal"], var.pg_admin_principal_type)
    error_message = "pg_admin_principal_type must be one of: Group, User, ServicePrincipal."
  }
}

variable "pg_sku_name" {
  type        = string
  description = "Flexible Server SKU (PoC-sized)."
  default     = "B_Standard_B2ms"
}

variable "pg_storage_mb" {
  type    = number
  default = 32768
}

variable "pg_version" {
  type    = string
  default = "16"
}

# ---- Models ----
variable "embedding_model" {
  type        = string
  description = "Embedding model for pgvector (no MAI embedder exists)."
  default     = "text-embedding-3-large"
}

variable "intent_model" {
  type        = string
  description = "Small/fast chat model for orchestrator intent routing."
  default     = "gpt-4o-mini"
}

variable "reasoning_model" {
  type        = string
  description = "Reasoning model for the analyze tool. Stopgap = gpt-5 (MAI-Thinking-1 is not GA/deployable). 1-line swap here when MAI ships."
  default     = "gpt-5"
}

# ---- Networking ----
# Operator/workstation public IP for the Postgres firewall during build (the
# "operator_ip"). Single /32 address (NOT CIDR notation — azurerm takes plain IPs).
# Tighten or use a private endpoint for anything beyond PoC. Leave null to skip the
# operator firewall rule (e.g. when running the data-plane bootstrap from Azure).
variable "allowed_client_ip" {
  type        = string
  description = "Operator/workstation public IP for the Postgres firewall during build (single IPv4 address). MUST be set at apply for out-of-band psql."
  default     = null
}
