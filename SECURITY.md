# Security policy

OpenCred signs documents that people's employment and education depend on. We
take reports seriously and we would rather hear about a problem from you than
from a customer.

## Reporting a vulnerability

**Please do not open a public issue.**

- Email **security@opencred.example** with the details.
- Or use GitHub's private vulnerability reporting on this repository.

Include what you need to make it reproducible: affected version or commit,
steps, and what an attacker gets out of it. A proof of concept helps; a working
exploit is not required.

### What to expect

| | |
|---|---|
| Acknowledgement | within 2 working days |
| Initial assessment | within 5 working days |
| Fix or mitigation for critical issues | target 14 days |
| Public disclosure | coordinated with you, default 90 days |

We will credit you in the advisory unless you would rather we did not.

## Scope

**In scope**

- Anything in this repository: the API, the web application, the shared
  packages, the Helm chart, the Dockerfiles, the integrations.
- The credential trust model: signature forgery, verification bypass, revocation
  bypass, issuer impersonation, status-list manipulation.
- Multi-tenancy: any path that reads or writes another organisation's data.
- Authentication and authorisation: privilege escalation, session fixation,
  token replay, API keys exceeding their role.
- Recipient privacy: anything that leaks a recipient's address or credential
  list to someone who should not have it.

**Out of scope**

- Findings against a deployment you do not control. Report those to its
  operator.
- Missing hardening headers with no demonstrated impact.
- Rate limiting on unauthenticated endpoints, unless you can show enumeration of
  credential identifiers at a rate that matters.
- Reports produced solely by a scanner, with no analysis.
- Social engineering, physical attacks, or denial of service by volume.

## What we consider a critical finding

These are the ones that would keep us up at night, listed so you know what we
are most interested in:

1. **Forging a credential** that our verifier, or any conformant verifier,
   accepts.
2. **Bypassing revocation** — making a revoked credential verify as valid, on
   the verification page or through the published status list.
3. **Reading another tenant's data** through any API path.
4. **Extracting an issuer's private key**, in any form, through any endpoint.
5. **Issuing as another organisation.**

## Design decisions you may want to probe

Stated plainly, because a security reviewer should not have to reverse-engineer
our reasoning:

- **Issuer private keys** are encrypted with AES-256-GCM using a key derived
  from `ENCRYPTION_KEY` via scrypt, and are never returned by any endpoint.
- **`eddsa-jcs-2022`** was chosen over JSON-LD/RDF canonicalisation so that
  verification needs no network fetch of `@context` documents. That is both a
  reliability property and an availability one.
- **Proof configuration is hashed separately from the document**, which binds a
  signature to its own `proofPurpose` and prevents cross-purpose replay. There
  is a test for this.
- **The credential's stated issuer is checked against the proof's controller.**
  A validly signed credential that claims a different issuer is rejected.
- **Status-list indices** are assigned by an atomic counter passed through a
  format-preserving permutation, so slots are unique under concurrency without a
  read-then-probe race, and the public list does not reveal issuance order or
  volume.
- **API keys** carry a role and can never be minted as `owner`.
- **Access tokens** live 15 minutes and the role is re-read from the database on
  every request, so a demotion takes effect immediately.
- **Refresh tokens** are single-use; reuse of a rotated token revokes every
  session for that user.
- **Template rendering** runs in a headless browser with the network disabled.
  Templates are user-supplied content, and a template that could fetch arbitrary
  URLs from inside our network would be an SSRF primitive. Assets are inlined as
  data URIs before the page is built.
- **Recipient identity in badges** is a salted SHA-256 commitment, not a
  plaintext address, with a per-credential salt so the same person is not
  correlatable across issuers.
- **Event logging** truncates IP addresses at write time — the last IPv4 octet
  or the last 80 bits of an IPv6 address are discarded and never stored.
- **The audit log is append-only by construction**: no code path updates or
  deletes an entry.

## Supported versions

During the 1.x series, security fixes land on the latest minor release. We do
not backport to earlier minors. Self-hosted operators should track releases.

## Hardening a self-hosted install

- Set `JWT_SECRET` and `ENCRYPTION_KEY` to 48+ random bytes. The API refuses to
  start in production with the shipped development values.
- `PUBLIC_URL` must be HTTPS. It is embedded in every credential and every DID
  document, and the API enforces this in production.
- Back up `ENCRYPTION_KEY` with the same care as your database. It cannot be
  rotated in place — it decrypts every organisation's signing key.
- Put the API behind a proxy that sets `X-Forwarded-For` correctly, or per-IP
  rate limiting will see only your load balancer.
- Restrict database and Valkey network access to the application. Neither should
  be reachable from the internet.
- Run `node scripts/check-integrity.mjs` on a schedule. It checks invariants
  whose violation is silent rather than loud.

## Dependencies

Dependency and container scanning runs in CI on every release. We keep the
dependency count deliberately low — the credential-signing path has no
third-party dependencies at all — because every package added is a package whose
patch cadence becomes our problem.
