# Architecture decisions

Short records of the choices that shaped this codebase, including the places
where the implementation deliberately departs from the original product
specification and why.

---

## 1. Certificates are Open Badges too

**Decision.** Every credential — certificate or badge — is issued as an Open
Badges 3.0 `AchievementCredential`, distinguished only by `achievementType`.

**Why.** An OB 3.0 `AchievementCredential` is already a conformant W3C
Verifiable Credential, and the 1EdTech vocabulary already has `Certificate`,
`Diploma`, `License` and `MicroCredential` in it. Issuing certificates as a
bespoke JSON shape would have meant two data models, two verification paths, and
a certificate product that is standards-adjacent rather than standards-native —
which is roughly where the rest of the category sits.

**Cost.** Certificates carry Open Badges vocabulary that a pure certificate
issuer may find unfamiliar. Worth it.

---

## 2. `eddsa-jcs-2022` rather than JSON-LD canonicalisation

**Decision.** Data Integrity proofs use the JCS (RFC 8785) cryptosuite, not
`eddsa-rdfc-2022`.

**Why.** RDF canonicalisation requires dereferencing every `@context` URL at
verification time. That makes a verifier dependent on the availability of
context hosts it does not control, and makes offline verification impossible —
which would defeat the point of a self-hosted, air-gapped Community Edition.
`eddsa-jcs-2022` is a registered W3C cryptosuite and verifies with no network
access at all.

**Cost.** Some ecosystem tooling assumes RDF canonicalisation. Both suites are
registered, so this is an interoperability preference rather than a conformance
gap, but it is a real trade.

---

## 3. Templates are DOM-shaped, not canvas-shaped

**Decision.** The template format is absolutely positioned boxes with CSS text
properties, rendered to HTML. The design studio renders the artwork by calling
the *same* `buildCanvasHtml` the render worker feeds to Chromium, and overlays a
transparent interaction layer for selection and dragging.

**Departs from the specification**, which named Fabric.js for the editor.

**Why.** A canvas editor paired with a separate print path means two layout
implementations that drift. The failure mode is specific and expensive: the
studio shows one thing, ten thousand recipients receive another, and nobody can
reproduce the report. With one layout engine that class of bug cannot exist.
HTML also gives correct RTL text shaping and font fallback for free, which
matters because recipient names arrive in every script there is.

**Cost.** No freeform rotation handles or path drawing. Neither appears in the
requirements.

---

## 4. First-party authentication rather than Ory Kratos

**Decision.** Local email/password with Argon2id, short-lived JWTs, rotating
single-use refresh tokens, and direct OAuth 2.0 against Google and Microsoft.

**Departs from the specification**, which named Ory Kratos and Hydra.

**Why.** Kratos is a strong choice for enterprise SSO, but it is a second
service with its own database, migrations and configuration surface — and FR-ID-04
requires a Community Edition that works with no dependency on any external
service. Making a one-command `docker compose up` install stand up two identity
services to log one person in is the kind of friction that decides whether an
evaluator ever sees the product.

**Cost.** SAML is not implemented; FR-ID-03 is a P1 requirement and remains
open. The `AuthPrincipal` abstraction is deliberately provider-shaped so Kratos
or a SAML broker can be introduced behind it without touching authorisation.

---

## 5. S3 signed by hand rather than the AWS SDK

**Decision.** The S3 storage driver implements AWS Signature Version 4 directly,
in about eighty lines.

**Why.** The SDK is roughly 15 MB of transitive dependencies for four HTTP
verbs. On a project whose central claim is "you can audit this", a signer a
reviewer can read beats a dependency tree they must trust. The same reasoning
keeps base58, JCS and the index permutation in-repo.

**Cost.** No IAM role chaining, no S3 Transfer Acceleration, no automatic
retries. Straightforward to add if anyone needs them.

---

## 6. Status-list indices are permuted, not randomised

**Decision.** A slot is allocated by atomically incrementing a counter and
passing it through a four-round Feistel permutation over 2^18, cycle-walked into
the 2^17 status-list domain.

**Why.** Two constraints pull in opposite directions. The spec asks issuers not
to assign sequentially, because the status list is deliberately public and
sequential slots would publish issuance volume and ordering. But the obvious fix
— pick at random, probe on collision — is a read-then-write race, and under
concurrent workers two credentials can land on the same slot. That is not a
cosmetic bug: revoking one would silently revoke a stranger's credential.

A permutation is injective by construction, so distinct counters can never
collide, while consecutive allocations land far apart. The atomic increment does
the concurrency work; the permutation does the privacy work.

**Found by** the load benchmark, not by unit tests — 8 concurrent workers
issuing into a fresh organisation. There is now a unique constraint on
`(statusListId, statusListIndex)` as a second guard, and a test asserting
injectivity over 20,000 counters.

---

## 7. Erasure is destructive, and says so

**Decision.** A GDPR erasure request revokes the affected credentials, deletes
their signed documents and rendered files, and pseudonymises the recipient — and
the interface states this plainly before you confirm.

**Why.** A credential is a signed statement about a named person. You cannot
remove the person and leave a valid credential; you leave a signature over data
that no longer exists. Quietly keeping the name inside a signed blob while
telling the data subject it was erased would be the comfortable product decision
and a false one.

The credential rows survive without personal data, so an issuer can still show
an auditor that a credential was issued and later erased.

---

## 8. Metering never applies to self-hosted installs

**Decision.** `UsageService` short-circuits entirely when the edition is not
`cloud`. No counting, no limits, no telemetry.

**Why.** Metering software somebody runs on their own hardware would contradict
the premise of the project, and any check we added would be trivially removable
anyway — so its only real function would be to signal distrust.

On Cloud, exceeding an allowance on a *paid* plan meters an overage rather than
blocking. A graduating cohort must not stop mid-batch because a counter rolled
over. Only the free tier hard-stops, and the pricing page says so.

---

## 9. Two-phase issuance

**Decision.** `POST /v1/credentials` validates, de-duplicates and reserves a
public id inside a transaction, then returns `202`. Signing, rendering, storage
and email happen in queue workers.

**Why.** It is what makes 10,000 credentials a capacity-planning question rather
than an HTTP timeout question, and it means a slow SMTP server can never fail an
issuance. It also gives idempotency a natural home: the queue job id is derived
from the credential id, so a retried API call collapses into one job.

**Cost.** A caller cannot synchronously receive a finished PDF. They receive an
identifier immediately, and `credential.issued` fires when it is ready.

---

## 10. One Nest module

**Decision.** The API is a single module rather than fifteen feature modules.

**Why.** Nest's feature-module convention buys isolation between teams working
on unrelated slices. This is one cohesive product where nearly everything
depends on issuance; splitting it would have produced circular-dependency
workarounds rather than clarity. When a boundary genuinely earns its own module
— the commercially licensed Enterprise module most obviously — it will get one.

---

## 11. Hand-written CSS rather than a utility framework

**Decision.** One `globals.css` with design tokens, no Tailwind.

**Why.** The public verification page is the one surface that must load fast on
a bad phone connection and score 90+ on Lighthouse mobile. It ships only the CSS
it needs, with no build plugin in the chain. The stylesheet is also a single
file a reviewer can read end to end, which is consistent with how the rest of
this codebase treats dependencies.

---

## 12. Localisation covers recipients, not issuers

**Decision.** The verification page, the not-found page and the recipient wallet
render in six languages including right-to-left Arabic. The issuer dashboard is
English only.

**Why.** The obvious alternative — a language selector across the whole product
— sounds more complete and is worse. The person who opens a verification page is
usually not the person who issued the credential and often not in the issuer's
country. They never see the dashboard. The registrar who does see the dashboard
chose this software and read its documentation in English. Translating the
surface with the widest and least-prepared audience is where the value is, and
shipping a selector that translates a third of the product would be a worse
promise than an honest gap.

**Honesty requirement attached to it.** The five non-English catalogues have not
been reviewed by native speakers. That is recorded in every locale file, in
`LOCALE_REVIEW`, and in `GET /v1/instance`, because these strings appear on a
page whose entire job is to be believed. A native review is a launch task.

**Not translated on purpose:** issuer-supplied content (credential titles,
descriptions, merge values) renders verbatim — we localise our interface around
somebody's credential, we do not machine-translate the credential. Identifiers
and DIDs render `dir="ltr"` even inside RTL pages, because an ASCII token in an
RTL paragraph reorders visually and gets transcribed wrong. Dates are localised
but pinned to UTC. See [localisation.md](localisation.md).

---

## 13. Deferred, and honestly so

These are specified but not implemented, and are not claimed anywhere in the
product surface:

| Requirement | Status |
|---|---|
| FR-ID-03 — SAML 2.0 SSO | Not implemented. OIDC via Google/Microsoft is. |
| FR-DES-06 — AI layout generation | Not implemented (P2 in the plan). |
| FR-STD-04 — Apple/Google Wallet passes | Not implemented (P1). |
| FR-DEL-03 — Credential pathways | Not implemented (P2). |
| FR-VER-04 — OpenTimestamps anchoring | Not implemented (P2). Verification reports `anchored: null` — "not checked", deliberately distinct from "checked and absent". |
| FR-INT-05 — Connector SDK | Not implemented (P1). The n8n node and Moodle plugin are the reference connectors. |
| FR-GOV-02 — Data residency selection | Infrastructure supports it; no in-product region picker. |
| Stripe billing | Plan changes work against the internal ledger. `BILLING_DRIVER=stripe` is a stub. |
| Meilisearch | Search uses PostgreSQL. Adequate at this scale; the interface is where it would slot in. |
| Localised delivery emails | The catalogue has the strings; there is no per-recipient locale to select with. Needs an organisation default plus a per-recipient override. |
| Native review of translations | Five locales ship unreviewed and say so. |
