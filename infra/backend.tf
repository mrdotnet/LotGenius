# Remote state backend.
#
# BOOTSTRAP ONCE (outside this module, before first `terraform init`):
#   az group create -n rg-steffes-tfstate -l <region>
#   az storage account create -n ststeffestfstate -g rg-steffes-tfstate \
#       -l <region> --sku Standard_LRS --min-tls-version TLS1_2
#   az storage container create --account-name ststeffestfstate -n tfstate \
#       --account-key "$(az storage account keys list -g rg-steffes-tfstate \
#         -n ststeffestfstate --query [0].value -o tsv)" -n tfstate
#
# AUTH = storage account ACCESS KEY (the azurerm backend default — no use_azuread_auth).
# The operator runs Terraform as a standing **Contributor**, which includes
# Microsoft.Storage/storageAccounts/listkeys/action, so the backend retrieves the key
# automatically via ARM. This deliberately avoids needing a data-plane role
# (Storage Blob Data Contributor) on the state container — i.e. NO extra RBAC grant is
# required just to hold state. (Switch to use_azuread_auth=true once the operator has a
# blob-data role, if shared-key access is later disabled on the account.)
#
# Keep the state account in its OWN resource group, separate from the resources
# this module manages, so a `terraform destroy` never deletes its own state.

terraform {
  backend "azurerm" {
    resource_group_name  = "rg-steffes-tfstate"
    storage_account_name = "ststeffestfstate01"
    container_name       = "tfstate"
    key                  = "lot-genius-poc.tfstate"
  }
}
