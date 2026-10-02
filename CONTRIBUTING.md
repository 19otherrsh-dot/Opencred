# Contributing to OpenCred

Thanks for being here. This document is short on ceremony and specific about the
things that actually matter on this project.

## Getting set up

```bash
git clone https://github.com/opencred/opencred
cd opencred
node scripts/bootstrap.mjs
```

Then run the checks. If these pass on your machine before you change anything,
you have a working environment:

```bash
npm test                          # unit tests across every package
node scripts/ob3-conformance.mjs  # specification conformance
node scripts/smoke-test.mjs       # end-to-end, needs the API and worker running
```

## The easiest first contribution: a template

Templates are plain JSON documents. A new *layout* becomes ten finished
templates, because the library is generated as 15 layouts × 10 themes.

1. Add a layout to `packages/templates/src/layouts.ts`.
2. Run `npm run templates:build`.
3. Run `npm run test -w @opencred/templates`.

The generator enforces the rules that keep the library usable, and it will fail
your build rather than let a broken design reach anyone:

- **The recipient name must be the largest text on a certificate.** It is the
  point of the document.
- **Every template needs a QR element**, because FR-VER-01 is not optional
  decoration.
- **Every merge field a template uses must be declared**, or a CSV import cannot
  validate against it.
- **Nothing within 24px of the trim edge.** These get printed on office printers
  with real margins.
- **Anything holding a recipient name must set `autoFit`.** Real cohorts contain
  names three times longer than the designer's mock, and without it a long name
  silently overflows on somebody's certificate.

Templates are CC0. By contributing one you place it in the public domain.

## Where things live

| Path | What it is |
|---|---|
| `packages/credentials` | Signing, verification, DIDs, status lists. **Read this first.** |
| `packages/schema` | Domain types, template format, roles, plans |
| `packages/renderer` | Template → HTML → PDF/PNG |
| `packages/templates` | The starter library and its generator |
| `apps/api` | NestJS API and queue workers |
| `apps/web` | Next.js dashboard, design studio, verification pages, wallet |

## Things this codebase cares about

**Dependencies are a cost, not a convenience.** `packages/credentials` has no
runtime dependencies at all — base58, JCS canonicalisation and the Feistel
permutation are implemented here on purpose, because a security team auditing
their credential signing path should be reading sixty lines rather than a
transitive dependency tree. A PR that adds a dependency to that package needs a
strong argument. Elsewhere, prefer the standard library where it is close.

**Comments explain why, not what.** We do not want `// increment the counter`.
We do want the paragraph explaining why status-list indices are permuted rather
than randomised, because the next person will otherwise "simplify" it back into
a race.

**Tests pin down behaviour that would otherwise fail silently.** The most
valuable tests here are the ones asserting things nobody would notice breaking:
that tampering invalidates a signature, that two counters never map to the same
status slot, that an Issuer cannot reach billing, that no plan has a setup fee.

**Never overclaim on standards.** We are not certified until 1EdTech says we
are. If you find language anywhere in the repository implying otherwise, that is
a bug worth a PR on its own.

**Honesty in the product surface too.** Erasure genuinely invalidates
credentials, and the UI says so rather than implying a clean deletion. Email
open rates are unreliable, and the analytics page says that next to the number.
If you are writing copy that would embarrass us in front of a well-informed
buyer, rewrite it.

## Pull requests

- One concern per PR. A bug fix and a refactor in the same diff is two PRs.
- Include a test for behaviour changes. If it is genuinely untestable, say why.
- Run `npm run typecheck` and `npm test`.
- If you touched the credential format, run `node scripts/ob3-conformance.mjs`.
- If you touched issuance, run `node scripts/smoke-test.mjs`.

Commit messages: a short imperative subject, and a body explaining why if the
reason is not obvious from the diff.

## Reporting bugs

Include the version or commit, what you expected, what happened, and — if it is
an API problem — the `requestId` from the error response. Every error we return
carries one, and it is how an operator finds the exact request in the logs.

## Security

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Licence

Contributions to the core platform are under AGPL-3.0-or-later. Template
contributions are CC0-1.0. By opening a pull request you confirm you have the
right to contribute the work under those terms.
