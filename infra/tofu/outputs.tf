output "database_endpoint" {
  description = "PostgreSQL endpoint."
  value       = aws_db_instance.this.address
}

output "database_url" {
  description = "Full connection string for the application."
  value       = "postgresql://opencred:${urlencode(random_password.database.result)}@${aws_db_instance.this.address}:5432/opencred?schema=public&sslmode=require"
  sensitive   = true
}

output "valkey_endpoint" {
  description = "Valkey endpoint used by the job queue."
  value       = aws_elasticache_cluster.this.cache_nodes[0].address
}

output "storage_bucket" {
  description = "Bucket holding rendered credentials."
  value       = aws_s3_bucket.credentials.id
}

output "encryption_key" {
  description = <<-EOT
    The platform encryption key.

    Back this up wherever you keep your database credentials. It decrypts every
    organisation's issuer private key and every stored SMTP password, and it
    cannot be rotated in place — losing it means every signing key in the
    installation becomes permanently unreadable, and no future credential can be
    issued under an existing issuer identity.
  EOT
  value       = random_password.encryption_key.result
  sensitive   = true
}

output "jwt_secret" {
  description = "Session signing secret. Rotating it signs everyone out; nothing worse."
  value       = random_password.jwt_secret.result
  sensitive   = true
}

output "public_url" {
  description = "The origin credentials are issued under."
  value       = var.public_url
}

output "issuer_did_note" {
  description = "How issuer identity derives from the public URL."
  value = "Organisations issue under did:web:${replace(replace(var.public_url, "https://", ""), "/", "")}:o:<workspace-slug> unless they verify their own custom domain."
}
