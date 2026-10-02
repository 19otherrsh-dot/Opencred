# Self-hosting OpenCred

The Community Edition is the complete core platform: the same design studio, the
same issuance engine, the same standards conformance, unlimited credentials,
under AGPLv3. Nothing is withheld from it to make the hosted service look
better.

This document covers the things that will actually bite you.

---

## The two settings you must get right

### `PUBLIC_URL`

This is not a cosmetic setting. It is embedded in:

- every credential's verification URL and QR code,
- the issuer DID (`did:web:your-host:o:workspace-slug`),
- the status-list URL that third-party verifiers fetch.

**Changing it after you have issued credentials breaks their issuer identity.**
Existing credentials will name a DID that no longer resolves, and external
verifiers will reject them. Choose the final hostname before you issue anything
real, and use HTTPS — the API refuses to start in production otherwise, because
`did:web` is only resolvable over HTTPS.

### `ENCRYPTION_KEY`

This decrypts every organisation's issuer private key and every stored SMTP
password.

**It cannot be rotated in place.** Losing it means every signing key in the
installation becomes permanently unreadable: you can still serve credentials
already issued, but you can never issue another one under an existing issuer
identity again.

Back it up with the same care as your database. The Helm chart annotates the
generated Secret with `helm.sh/resource-policy: keep` so an upgrade cannot
regenerate it, and the OpenTofu module marks it `prevent_destroy`. Neither
protects you from not having a copy.

```bash
openssl rand -base64 48   # for both JWT_SECRET and ENCRYPTION_KEY
```

`JWT_SECRET` is the harmless one: rotating it signs everybody out and does
nothing worse.

---

## Docker Compose

The whole platform on one host. Suitable for a department, a bootcamp, or a
pilot — anything up to a few hundred thousand credentials a year.

```bash
cp .env.example .env
# set PUBLIC_URL, JWT_SECRET, ENCRYPTION_KEY
docker compose --profile full up -d
```

That runs PostgreSQL, Valkey, MinIO, Mailpit, the API, a worker and the web app.
Ports are configurable (`POSTGRES_PORT`, `VALKEY_PORT`, …) because a developer
machine usually already has something on 5432.

Put a TLS-terminating reverse proxy in front of it. Route `/api` and
`/.well-known` to the API on port 4000 and everything else to the web app on
3000 — `.well-known` matters because it serves DID documents.

**Replace Mailpit before you go live.** It captures mail and delivers nothing.

---

## Kubernetes

```bash
helm install opencred infra/helm/opencred \
  --namespace opencred --create-namespace \
  -f my-values.yaml
```

A production `my-values.yaml` looks roughly like this:

```yaml
opencred:
  publicUrl: https://credentials.example.edu
  apiUrl: https://credentials.example.edu/api

# The bundled subcharts are for evaluation. They have no backup schedule,
# no point-in-time recovery and no failover.
postgresql: { enabled: false }
valkey: { enabled: false }
externalDatabase:
  url: postgresql://opencred:…@db.internal:5432/opencred?sslmode=require
externalValkey:
  url: redis://valkey.internal:6379

storage:
  driver: s3
  s3:
    endpoint: https://s3.eu-west-1.amazonaws.com
    region: eu-west-1
    bucket: opencred-credentials
    existingSecret: opencred-s3

secrets:
  existingSecret: opencred-secrets   # managed by External Secrets or Vault

mail:
  host: email-smtp.eu-west-1.amazonaws.com
  from: "Example University <credentials@example.edu>"
  existingSecret: opencred-smtp

worker:
  replicaCount: 4
  autoscaling: { enabled: true, minReplicas: 4, maxReplicas: 20 }
```

Schema migrations run as a `pre-upgrade` Helm hook, so application code never
meets a schema it does not understand.

### Two Kubernetes gotchas

**`/dev/shm`.** Chromium's default 64 MB shared memory segment causes tab
crashes under concurrent rendering — the classic "Target closed" error. The
chart mounts a 512 MB memory-backed `emptyDir` at `/dev/shm` for workers. If you
write your own manifests, do the same.

**Worker memory.** Chromium is memory-hungry. Under-requesting is the most
common cause of workers being OOM-killed mid-batch. Start at 1 Gi requested,
2 Gi limit, and watch it.

---

## Cloud infrastructure

`infra/tofu` provisions RDS PostgreSQL, ElastiCache running Valkey, an S3 bucket
with versioning and encryption, IAM, and optionally installs the Helm chart onto
a cluster you already have.

```bash
cd infra/tofu
tofu init
tofu plan  -var-file=production.tfvars
tofu apply -var-file=production.tfvars
```

It deliberately does not create the cluster. Institutions running this already
have one, with their own networking and compliance posture attached to it.

---

## Rendering

Credentials are rendered by headless Chromium via Playwright. Without it the
platform still issues and signs — output degrades to vector SVG, and the API
reports `"rendering": "svg-fallback"` at `/v1/instance` rather than failing
silently.

```bash
npx playwright install --with-deps chromium
```

The shipped Docker image includes Chromium and the Noto font families, so
Devanagari, Arabic and CJK recipient names render as glyphs rather than tofu
boxes. If you build your own image, keep the fonts.

---

## Scaling

The API is stateless; scale it on request rate. Workers are the interesting
part: rendering is CPU-bound, and throughput is close to linear in worker
replicas until the database becomes the limit.

```bash
node scripts/benchmark-issuance.mjs --count 10000
```

That issues a real batch and reports throughput against the 10,000-in-5-minutes
target. Run it on your own hardware — a benchmark from someone else's laptop
tells you nothing about yours.

---

## Backups

Three things need backing up, and only the first is obvious:

1. **PostgreSQL** — everything transactional, including the signed credential
   documents.
2. **`ENCRYPTION_KEY`** — see above. Without it, a restored database is a museum.
3. **Object storage** — rendered PDFs and PNGs. These are regenerable from the
   database and templates, but regenerating a decade of them is a bad afternoon.

Valkey holds in-flight jobs. Losing it loses work that was accepted from a
customer but not yet delivered, which is why the OpenTofu module enables
snapshots on it.

## Health and monitoring

| Endpoint | Purpose |
|---|---|
| `/healthz` | Liveness. Touches no dependency, on purpose — a database blip must not make Kubernetes restart every API pod. |
| `/readyz` | Readiness. Checks the database, the queue and the renderer. |
| `/metrics` | Prometheus, including per-queue depth and failure counts. |
| `/v1/instance` | What this deployment is, and what it talks to. |

Queue depth is the metric that tells you whether workers are keeping up. Alert
on it rising steadily rather than on absolute values.

Run `node scripts/check-integrity.mjs` on a schedule. It checks invariants whose
violation is silent: two credentials sharing a revocation slot, a revoked
credential whose status-list bit is clear, an issued credential with no
signature.

## Does it phone home?

No. `TELEMETRY_ENABLED` defaults to `false` and there is no default endpoint. A
self-hosted install makes no outbound connections except to the SMTP host you
configure and, if you enable it, the DID resolution fetch when verifying a
credential from another issuer.

`GET /v1/instance` reports exactly what a given deployment talks to, so you can
confirm this from the software rather than from our documentation.
