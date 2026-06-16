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
  default     = "centralus"
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
  description = "Object ID of the 'Lot Genius Admins' Entra group (set as Postgres Entra admin; granted Synapse SELECT out-of-band)."
}

variable "manage_app_regs" {
  type        = bool
  description = "Whether Terraform manages Entra app registrations (requires Application Administrator). If false, pass existing IDs."
  default     = false
}

# ---- Postgres ----
variable "pg_admin_login" {
  type        = string
  description = "Postgres Entra admin principal name (operator UPN or the admins group)."
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
  description = "Reasoning model for the analyze tool (MS Build MAI launch)."
  default     = "MAI-Thinking-1"
}

# ---- Networking ----
variable "allowed_client_ip" {
  type        = string
  description = "Operator public IP for the Postgres firewall during build (CIDR /32). Tighten or use private endpoint for anything beyond PoC."
  default     = null
}
