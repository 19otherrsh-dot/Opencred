/**
 * OpenCred infrastructure.
 *
 * Provisions the stateful layer — PostgreSQL, Valkey, object storage and the
 * platform secrets — and optionally installs the Helm chart onto a cluster you
 * already have.
 *
 * It deliberately does NOT create the Kubernetes cluster. Institutions running
 * this almost always have one already, with their own networking, IAM and
 * compliance posture attached to it, and a module that insisted on building its
 * own would be unusable to exactly the buyers this platform is aimed at.
 */

locals {
  name = "${var.name}-${var.environment}"

  tags = merge(
    {
      Application = "opencred"
      Environment = var.environment
      ManagedBy   = "opentofu"
    },
    var.tags,
  )
}

# ---------------------------------------------------------------- secrets ----

resource "random_password" "database" {
  length = 32
  # RDS rejects several punctuation characters in master passwords, and the
  # failure surfaces as an unhelpful API error hundreds of seconds into apply.
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

# The one secret that genuinely cannot be rotated in place: it decrypts every
# organisation's issuer private key. `prevent_destroy` is here because a
# `tofu destroy` that took this with it would render every stored signing key
# permanently unreadable.
resource "random_password" "encryption_key" {
  length  = 64
  special = false

  lifecycle {
    prevent_destroy = true
  }
}

# --------------------------------------------------------------- database ----

resource "aws_security_group" "database" {
  name        = "${local.name}-db"
  description = "OpenCred PostgreSQL"
  vpc_id      = var.vpc_id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  for_each = toset(var.allowed_security_group_ids)

  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from ${each.value}"
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.name}-db"
  subnet_ids = var.private_subnet_ids
  tags       = local.tags
}

resource "aws_db_instance" "this" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = "16"

  instance_class        = var.database.instance_class
  allocated_storage     = var.database.allocated_storage
  max_allocated_storage = var.database.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "opencred"
  username = "opencred"
  password = random_password.database.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false

  multi_az                = var.database.multi_az
  backup_retention_period = var.database.backup_retention_days
  backup_window           = "02:00-03:00"
  maintenance_window      = "sun:03:30-sun:04:30"
  copy_tags_to_snapshot   = true

  # Credentials are records people rely on for years. Skipping the final
  # snapshot on delete is not a corner worth cutting.
  deletion_protection       = var.database.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-db-final"

  performance_insights_enabled = var.database.performance_insights
  enabled_cloudwatch_logs_exports = ["postgresql"]

  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = local.tags
}

# ------------------------------------------------------------------ cache ----

resource "aws_security_group" "cache" {
  name        = "${local.name}-cache"
  description = "OpenCred Valkey job queue"
  vpc_id      = var.vpc_id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "cache" {
  for_each = toset(var.allowed_security_group_ids)

  security_group_id            = aws_security_group.cache.id
  referenced_security_group_id = each.value
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  description                  = "Valkey from ${each.value}"
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${local.name}-cache"
  subnet_ids = var.private_subnet_ids
  tags       = local.tags
}

resource "aws_elasticache_cluster" "this" {
  cluster_id = "${local.name}-cache"
  # Valkey rather than the Redis engine, consistently with the application's
  # own dependency choice.
  engine          = "valkey"
  engine_version  = "8.0"
  node_type       = var.cache.node_type
  num_cache_nodes = var.cache.num_cache_nodes
  port            = 6379

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.cache.id]

  # The queue holds in-flight issuance jobs. Losing it loses work that has been
  # accepted from a customer but not yet delivered.
  snapshot_retention_limit = 5
  snapshot_window          = "01:00-02:00"
  maintenance_window       = "sun:04:30-sun:05:30"

  tags = local.tags
}

# --------------------------------------------------------- object storage ----

resource "aws_s3_bucket" "credentials" {
  bucket        = "${local.name}-credentials"
  force_destroy = var.storage.force_destroy
  tags          = local.tags
}

resource "aws_s3_bucket_public_access_block" "credentials" {
  bucket = aws_s3_bucket.credentials.id

  # Rendered credentials are served through the API, which applies the
  # organisation's own visibility rules. The bucket itself is never public.
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "credentials" {
  bucket = aws_s3_bucket.credentials.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "credentials" {
  bucket = aws_s3_bucket.credentials.id

  versioning_configuration {
    # On by default: a post-issuance correction overwrites a rendered file, and
    # versioning is what lets an issuer answer "what did the original look
    # like?" during a dispute.
    status = var.storage.versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "credentials" {
  bucket = aws_s3_bucket.credentials.id

  rule {
    id     = "expire-noncurrent"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.storage.noncurrent_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# An IAM user rather than IRSA so the module works on any cluster, including
# self-managed and non-EKS ones. On EKS, prefer IRSA and skip these.
resource "aws_iam_user" "storage" {
  name = "${local.name}-storage"
  tags = local.tags
}

resource "aws_iam_user_policy" "storage" {
  name = "${local.name}-storage"
  user = aws_iam_user.storage.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.credentials.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.credentials.arn
      },
    ]
  })
}

resource "aws_iam_access_key" "storage" {
  user = aws_iam_user.storage.name
}

# ------------------------------------------------------------------- helm ----

resource "helm_release" "opencred" {
  count = var.chart.install ? 1 : 0

  name             = var.name
  chart            = var.chart.path
  namespace        = var.chart.namespace
  create_namespace = var.chart.create_namespace

  # Long enough for the pre-upgrade migration job plus image pulls of an image
  # that carries Chromium.
  timeout = 900
  wait    = true
  atomic  = true

  values = [
    yamlencode({
      image = {
        repository    = var.chart.api_image
        webRepository = var.chart.web_image
        tag           = var.chart.tag
      }

      opencred = {
        edition   = var.chart.edition
        publicUrl = var.public_url
        apiUrl    = "${var.public_url}/api"
      }

      # The bundled subcharts exist for evaluation. Here we have real managed
      # services, so they are off.
      postgresql = { enabled = false }
      valkey     = { enabled = false }

      externalDatabase = {
        url = "postgresql://opencred:${urlencode(random_password.database.result)}@${aws_db_instance.this.address}:5432/opencred?schema=public&sslmode=require"
      }
      externalValkey = {
        url = "redis://${aws_elasticache_cluster.this.cache_nodes[0].address}:6379"
      }

      secrets = {
        jwtSecret     = random_password.jwt_secret.result
        encryptionKey = random_password.encryption_key.result
      }

      storage = {
        driver = "s3"
        s3 = {
          endpoint        = "https://s3.${var.region}.amazonaws.com"
          region          = var.region
          bucket          = aws_s3_bucket.credentials.id
          forcePathStyle  = false
          accessKeyId     = aws_iam_access_key.storage.id
          secretAccessKey = aws_iam_access_key.storage.secret
        }
      }

      mail = {
        transport = var.mail.host == "" ? "log" : "smtp"
        host      = var.mail.host
        port      = var.mail.port
        secure    = var.mail.secure
        user      = var.mail.user
        password  = var.mail.password
        from      = var.mail.from
      }

      ingress = {
        enabled   = true
        className = var.chart.ingress_class
        host      = replace(replace(var.public_url, "https://", ""), "/", "")
      }

      telemetry = { enabled = false }
    }),
    var.chart.extra_values,
  ]

  depends_on = [
    aws_db_instance.this,
    aws_elasticache_cluster.this,
    aws_s3_bucket_public_access_block.credentials,
  ]
}
