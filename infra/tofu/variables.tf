variable "name" {
  description = "Name prefix for every resource this module creates."
  type        = string
  default     = "opencred"
}

variable "environment" {
  description = "Environment name, used in tags and resource names."
  type        = string
  default     = "production"
}

variable "region" {
  description = "AWS region. Also determines where credential data lives, which is a data-residency decision, not just a latency one."
  type        = string
  default     = "eu-west-1"
}

variable "vpc_id" {
  description = "Existing VPC to deploy into."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the database and cache. At least two, in different availability zones."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "RDS and ElastiCache subnet groups require at least two subnets in different availability zones."
  }
}

variable "allowed_security_group_ids" {
  description = "Security groups permitted to reach the database and cache — typically your cluster's node group."
  type        = list(string)
}

variable "public_url" {
  description = <<-EOT
    The externally reachable HTTPS origin, for example https://credentials.example.edu.

    This is not a cosmetic setting. It is embedded in every issued credential, in
    every QR code, and in the issuer DID document that external verifiers
    resolve. Changing it after credentials have been issued breaks their issuer
    identity, so choose it once and keep it.
  EOT
  type        = string

  validation {
    condition     = startswith(var.public_url, "https://")
    error_message = "public_url must be HTTPS: DID documents are only resolvable over HTTPS."
  }
}

variable "database" {
  description = "PostgreSQL sizing."
  type = object({
    instance_class          = optional(string, "db.t4g.medium")
    allocated_storage       = optional(number, 50)
    max_allocated_storage   = optional(number, 500)
    backup_retention_days   = optional(number, 14)
    multi_az                = optional(bool, true)
    deletion_protection     = optional(bool, true)
    performance_insights    = optional(bool, true)
  })
  default = {}
}

variable "cache" {
  description = "Valkey sizing for the job queue."
  type = object({
    node_type       = optional(string, "cache.t4g.small")
    num_cache_nodes = optional(number, 1)
  })
  default = {}
}

variable "storage" {
  description = "Object storage for rendered credentials."
  type = object({
    force_destroy      = optional(bool, false)
    versioning         = optional(bool, true)
    noncurrent_days    = optional(number, 90)
  })
  default = {}
}

variable "chart" {
  description = "Helm release settings."
  type = object({
    install            = optional(bool, true)
    namespace          = optional(string, "opencred")
    create_namespace   = optional(bool, true)
    path               = optional(string, "../helm/opencred")
    api_image          = optional(string, "ghcr.io/opencred/opencred-api")
    web_image          = optional(string, "ghcr.io/opencred/opencred-web")
    tag                = optional(string, "1.0.0")
    edition            = optional(string, "community")
    ingress_class      = optional(string, "nginx")
    extra_values       = optional(string, "")
  })
  default = {}
}

variable "mail" {
  description = "SMTP settings for platform email. Per-organisation SMTP is configured in the application itself."
  type = object({
    host     = optional(string, "")
    port     = optional(number, 587)
    secure   = optional(bool, false)
    user     = optional(string, "")
    password = optional(string, "")
    from     = optional(string, "OpenCred <no-reply@example.edu>")
  })
  default   = {}
  sensitive = true
}

variable "tags" {
  description = "Extra tags applied to every resource."
  type        = map(string)
  default     = {}
}
