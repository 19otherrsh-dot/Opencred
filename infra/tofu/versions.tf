# OpenTofu, not Terraform.
#
# A small proof point rather than a preference: HashiCorp relicensed Terraform
# to the BSL in 2023, and OpenTofu is the community-governed MPL-2.0 fork. A
# project whose entire thesis is "genuinely open source" should not ship
# source-available infrastructure tooling and hope nobody checks. The same
# reasoning put Valkey in the stack instead of post-2024 Redis.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.14"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
