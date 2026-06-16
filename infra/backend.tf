# Remote state backend.
#
# BOOTSTRAP ONCE (outside this module, before first `terraform init`):
#   az group create -n rg-steffes-tfstate -l <region>
#   az storage account create -n ststeffestfstate -g rg-steffes-tfstate \
#       -l <region> --sku Standard_LRS --min-tls-version TLS1_2
#   az storage container create --account-name ststeffestfstate -n tfstate \
#       --auth-mode login
#
# The identity running Terraform needs **Storage Blob Data Contributor** on the
# state container (data-plane — Contributor on the account is NOT enough).
#
# Keep the state account in its OWN resource group, separate from the resources
# this module manages, so a `terraform destroy` never deletes its own state.

terraform {
  backend "azurerm" {
    resource_group_name  = "rg-steffes-tfstate"
    storage_account_name = "ststeffestfstate"
    container_name       = "tfstate"
    key                  = "lot-genius-poc.tfstate"
    use_azuread_auth     = true
  }
}
