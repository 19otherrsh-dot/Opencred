<div align="center">

# OpenCred

**The open-source, standards-native credentialing platform.**

Issue certificates and Open Badges 3.0 at scale. Sign them cryptographically.
Let anyone verify them without an account — or without you.

[Quick start](#quick-start) · [Why this exists](#why-this-exists) · [Architecture](#architecture) · [Self-hosting](docs/self-hosting.md) · [API](#api)

`AGPL-3.0-or-later` · Open Badges 3.0 · W3C Verifiable Credentials · `did:web`

</div>

---

## Why this exists

The digital credentialing market has six vendors selling the same feature set —
drag-and-drop editor, CSV import, QR verification, LinkedIn button — one closed
enterprise incumbent with a network moat, and a cluster of blockchain-first
challengers selling institutional trust.

**Not one of them is open source.** Every one is a closed destination SaaS. The
vendors whose entire pitch is "trust and permanence" will not let you read the
code that produces your signatures, and the vendor whose pitch is "data
sovereignty" means their servers are in your region, not that you can run the
software.

OpenCred is the answer to a simple question: what would this category look like
if the thing protecting the credential were something you could actually audit,
fork, and run yourself?

Concretely, it means:

| | |
|---|---|
| **Auditable** | The core platform is AGPLv3. The signing path is ~400 lines you can read in an afternoon, with no third-party crypto library between an issuer's private key and the signature. |
| **Standards-native** | Every credential — certificates included, not just badges — is an Open Badges 3.0 `AchievementCredential` and therefore a W3C Verifiable Credential, with a detached `eddsa-jcs-2022` Data Integrity proof. |
| **Verifiable without us** | Issuer identity is `did:web` on the issuer's own domain. Revocation is a W3C Bitstring Status List. A third party can verify a credential offline with any conformant verifier. |
| **Yours to run** | Managed cloud, or self-hosted Community Edition via Docker Compose or Helm. Self-hosted installs are never metered, never limited, and make no outbound calls except the SMTP host you configure. |
| **Readable by the recipient** | Verification pages and the wallet render in the visitor's language — English, Spanish, French, Portuguese, Hindi, Arabic — including right-to-left. The person checking a credential is usually not in the issuer's country. |
| **Priced in public** | Every tier published, including the Enterprise starting price. No setup fee on any plan. Full CSV and JSON export at any time, from a normal endpoint, without contacting support. |

## Quick start

```bash
git clone https://github.com/opencred/opencred
cd opencred
node scripts/bootstrap.mjs
```

The bootstrap script checks your toolchain, generates real secrets into `.env`,
starts PostgreSQL, Valkey and a local mail catcher, applies the schema, builds,
installs Chromium and seeds a demo workspace. It prints what it is about to do
at every step.

Then, in three terminals:

```bash
npm run dev:api      # http://localhost:4000
npm run dev:worker   # signs and renders credentials
npm run dev:web      # http://localhost:3000
```

Sign in at <http://localhost:3000/login> with `demo@opencred.local` /
`opencred-demo-password`.

<details>
<summary>Or do it by hand</summary>

```bash
cp .env.example .env                 # then set JWT_SECRET and ENCRYPTION_KEY
npm install
docker compose up -d postgres valkey mailpit
npm run build:packages
npm run db:push
npm run build:api
npx playwright install chromium      # optional; without it output is SVG
npm run db:seed
```

If port 5432 is taken, set `POSTGRES_PORT` in `.env` and update `DATABASE_URL`
to match.

</details>

### Prove it works

```bash
npm run check:all                   # everything below, in order

node scripts/smoke-test.mjs          # 73 end-to-end checks against a live API
node scripts/ob3-conformance.mjs     # 36 Open Badges 3.0 / VC specification checks
node scripts/check-integrity.mjs     # data invariants no type system can enforce
node scripts/check-localisation.mjs  # 27 checks incl. right-to-left rendering
node scripts/check-accessibility.mjs # 84 structural WCAG checks
node scripts/prd-audit.mjs           # the product spec's own acceptance criteria
node scripts/benchmark-issuance.mjs --count 1000
```

`prd-audit.mjs` is the one to run if you want to know what is actually built: it
walks the functional requirements, tests the acceptance criteria that can be
tested against a running instance, and reports anything it cannot test as
NOT-TESTED rather than quietly counting it as a pass.

The smoke test signs up, issues, verifies, tampers, corrects, revokes and
exports — speaking only HTTP and the public credential format. If it passes, an
integrator following the published docs can do everything it does.

## What a credential actually is

Not a PDF with a QR code pointing at a database row. A signed, portable document
that stands on its own:

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"
  ],
  "id": "urn:uuid:6f5c1f7e-…",
  "type": ["VerifiableCredential", "OpenBadgeCredential"],
  "issuer": {
    "id": "did:web:certs.example.edu",      // resolved from the issuer's own domain
    "type": ["Profile"],
    "name": "Example University"
  },
  "validFrom": "2026-03-01T00:00:00.000Z",
  "credentialSubject": {
    "type": ["AchievementSubject"],
    "identifier": [{                         // salted hash, not a plaintext address:
      "type": "IdentityObject",              // a shared badge shouldn't leak an email
      "identityHash": "sha256$4f2a…",
      "identityType": "emailAddress",
      "hashed": true,
      "salt": "…"
    }],
    "achievement": {
      "type": ["Achievement"],
      "name": "Advanced Data Engineering",
      "achievementType": "Certificate",
      "criteria": { "narrative": "…" }
    }
  },
  "credentialStatus": {                      // revocation a third party can check
    "type": "BitstringStatusListEntry",
    "statusListCredential": "https://certs.example.edu/v1/public/status/example/1",
    "statusListIndex": "4711"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",         // offline-verifiable: no context fetch
    "verificationMethod": "did:web:certs.example.edu#key-1",
    "proofValue": "z3Ff…"
  }
}
```

Change any field and the signature fails. Revoke it and every verifier — ours
and anyone else's — sees it. Delete our servers and it still verifies, because
the trust root is the issuer's domain, not our database.

## Architecture

```
                       ┌────────────────────────┐
   employer scans ────▶│  Verification pages    │  server-rendered, cacheable,
   a QR code           │  /v/:id  ·  public API │  no login, no JavaScript needed
                       └───────────┬────────────┘
                                   │
┌──────────────┐   ┌───────────────▼──────────────┐   ┌──────────────────┐
│ Admin web    │   │  Core API (NestJS)           │   │ Recipient wallet │
│ + Design     │──▶│  auth · templates · issuance │◀──│ (PWA, magic link)│
│   studio     │   │  verification · analytics    │   └──────────────────┘
└──────────────┘   └───────┬──────────────┬───────┘
                           │              │
              ┌────────────▼───┐   ┌──────▼─────────┐
              │ Issuance queue │   │ Webhooks · n8n │
              │ (BullMQ)       │   │ · Moodle       │
              └────────┬───────┘   └────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │ Sign (Ed25519) → Render     │   the API returns in milliseconds;
        │ (Chromium → PDF/PNG) → Mail │   this is where the seconds go
        └──────────────┬──────────────┘
                       │
              ┌────────▼─────────┐
              │ Object storage   │
              └──────────────────┘

PostgreSQL · Valkey · MinIO/S3 · Playwright
```

The split that matters: **accepting** a batch is a database write, **completing**
it is queue work. That is why 10,000 credentials is a capacity question rather
than an HTTP timeout question, and why a slow SMTP server can never fail an
issuance.

### Repository layout

```
packages/
  schema/         domain types, template format, merge fields, roles, plans
  credentials/    Open Badges 3.0, VC Data Integrity, DIDs, status lists  ← the core
  renderer/       template → HTML → PDF/PNG (shared by the studio and the workers)
  templates/      160 CC0 starter designs, generated from 16 layouts × 10 themes
  i18n/           message catalogues for the recipient-facing surfaces
apps/
  api/            NestJS API + queue workers + Prisma schema
  web/            Next.js dashboard, design studio, verification pages, wallet
integrations/
  n8n-nodes-opencred/   n8n node + trigger
  moodle/               Moodle plugin, issues on course completion
infra/
  docker/ helm/ tofu/   container images, Helm chart, OpenTofu module
scripts/          bootstrap, smoke test, conformance gate, benchmark, integrity audit
```

`packages/credentials` is the part to read first. It has no dependencies beyond
Node's standard library, and it is the whole of the trust story.

## API

Interactive reference at `/docs` on the API, generated from the running server —
so it cannot describe an API this build does not have.

```bash
# Issue
curl -X POST http://localhost:4000/v1/credentials \
  -H "Authorization: Bearer ock_live_…" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "8f2b…",
    "recipient": { "name": "Ada Lovelace", "email": "ada@example.com" },
    "data": { "course": "Advanced Data Engineering", "grade": "Distinction" },
    "idempotencyKey": "course-42-user-1071"
  }'

# Verify — no authentication, ever
curl http://localhost:4000/v1/public/credentials/k7m2q9xb4t

# Verify a document we did not issue, against its own issuer's DID
curl -X POST http://localhost:4000/v1/public/verify \
  -H "Content-Type: application/json" -d '{ "credential": { … } }'
```

Always send an `idempotencyKey` from an event handler that can retry. One
redelivered LMS webhook without it means one duplicate diploma.

## Deploying

| | |
|---|---|
| **Docker Compose** | `docker compose --profile full up -d` — the whole platform on one host |
| **Kubernetes** | `helm install opencred infra/helm/opencred -f my-values.yaml` |
| **Cloud infra** | `infra/tofu` provisions RDS, ElastiCache (Valkey), S3 and installs the chart |

See [docs/self-hosting.md](docs/self-hosting.md) for the details that matter —
particularly `PUBLIC_URL`, which is baked into every credential and every issuer
DID, and `ENCRYPTION_KEY`, which cannot be rotated in place.

## Standards status

**Read this carefully, because the category is full of overclaiming.**

| | Status |
|---|---|
| Open Badges 3.0 data model | Implemented; validated by a 36-check local gate in CI |
| W3C VC Data Model 2.0 | Implemented |
| VC Data Integrity, `eddsa-jcs-2022` | Implemented, with tamper and replay tests |
| `did:web` issuer identity | Implemented, with key rotation that preserves historic credentials |
| W3C Bitstring Status List 1.0 | Implemented, signed, publicly served |
| **1EdTech certification** | **Not certified.** Not submitted. |

`scripts/ob3-conformance.mjs` is our own reading of the specification, not the
1EdTech conformance suite. Passing it confers no certification. Nothing in this
repository may be marketed as certified until 1EdTech lists it on their public
registry — that rule is written into the conformance script's own output.

## Licence

The core platform is **AGPL-3.0-or-later** ([LICENSE](LICENSE)). Copyleft is
deliberate: you may run this for any purpose, modify it, and self-host it
freely, but a competitor cannot take it, host it as a rival service, and
contribute nothing back.

The 150 starter templates in `packages/templates/library` are
[CC0-1.0](packages/templates/LICENSE) — public domain, no attribution required,
use them anywhere.

The Moodle plugin is GPL-3.0-or-later, as Moodle plugins must be.

One dependency is worth naming precisely rather than glossing: **n8n is
source-available under the Sustainable Use Licence, not OSI open source.** It is
an optional automation integration, and we describe it accurately wherever it
appears.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The easiest first contribution is a
template: they are plain JSON files, they render in a diff, and one new layout
becomes ten finished designs.

Security issues: [SECURITY.md](SECURITY.md). Please do not open a public issue.
