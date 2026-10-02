# Localisation

OpenCred's **recipient-facing surfaces** render in the visitor's language,
including right-to-left. The issuer dashboard is English only.

That split is deliberate and worth explaining, because the obvious alternative —
a language selector covering the whole product — would be worse. The person who
opens a verification page is usually not the person who issued the credential
and often not in the issuer's country: a Brazilian graduate forwarding a link to
a recruiter in Lisbon, an employer in Mumbai checking a candidate. Those people
never see the dashboard. The registrar who does see the dashboard chose this
software and reads its documentation. Translating the surface with the widest,
least-prepared audience first is where the value is.

## What is localised

| Surface | Localised |
|---|---|
| Verification page (`/v/:id`) | Yes |
| Credential not found | Yes |
| Recipient wallet (`/wallet`) | Yes |
| Delivery email | No — see below |
| Issuer dashboard | No |
| Marketing and pricing pages | No |

## Languages

| Code | Language | Direction | Review status |
|---|---|---|---|
| `en` | English | LTR | Source of truth |
| `es` | Spanish | LTR | **Unreviewed** |
| `fr` | French | LTR | **Unreviewed** |
| `pt` | Portuguese (Brazilian usage) | LTR | **Unreviewed** |
| `hi` | Hindi | LTR | **Unreviewed** |
| `ar` | Arabic | **RTL** | **Unreviewed** |

The five non-English languages match the buyer geographies in the product plan:
the US and EU, LATAM, and South Asia. Arabic is additionally there because it is
what proves the right-to-left path actually works — a layout engine that has
never rendered RTL is one that will break the first time it does.

### "Unreviewed" means unreviewed

Those strings were drafted and have **not** been through a native speaker. This
is stated in every locale file, reported by `GET /v1/instance`, and surfaced in
`LOCALE_REVIEW`. It is recorded rather than glossed over because these strings
appear on a page whose entire job is to be believed, and a subtly wrong
translation on a credential verification page costs more trust than an English
fallback would.

Getting a native review is a launch task, not an engineering one. Do not remove
the markers without one.

## How a locale is chosen

1. An explicit `?lang=` in the URL.
2. The `Accept-Language` header, with quality values honoured and regional tags
   falling back to their base language (`pt-BR` → `pt`).
3. English.

`?lang=` wins on purpose. Credentials get forwarded to people whose browser
language differs from the recipient's, and an issuer emailing a Spanish-speaking
cohort should be able to send links that open in Spanish regardless of the
device. It also makes the choice shareable.

There is no cookie and no stored preference. A verification page is a document
someone opens once, not an application they configure.

## What is *not* translated

**Issuer-supplied content.** Credential titles, descriptions, achievement names,
merge field values, revocation reasons — all render verbatim in whatever
language the issuer wrote them. We localise our interface around somebody's
credential; we do not machine-translate the credential. A test asserts this.

**Credential identifiers and DIDs.** Rendered with `dir="ltr"` even inside an
RTL page. A bare ASCII token in an RTL paragraph reorders visually, and someone
transcribing it from the screen would get it wrong.

**Dates.** Formatted in the visitor's language but **always in UTC**. The
language part is a courtesy; the UTC part is a correctness requirement. A
credential that appears to have been issued on different days depending on who
is looking is a credential somebody will question. English maps to `en-GB`
formatting for the same reason — `March 1, 2026` is US-centric and `3/1/2026`
means two different days to two different readers.

## Right-to-left

Handled at three layers, none of which is a second stylesheet:

1. **The page** sets `dir="rtl"` on its root when the locale is RTL.
2. **The stylesheet** uses logical properties (`margin-inline`,
   `inset-inline-start`, `border-inline-end`, `text-align: start`) so mirroring
   is automatic.
3. **The renderer** carries `direction` on the template document, emits it on
   the canvas root, and includes Noto Sans Arabic in the font stack so glyphs
   shape and join rather than rendering as disconnected letters or tofu boxes.

The library ships ten Arabic RTL certificate templates (`rtl-formal-*`), and
`scripts/check-localisation.mjs` asserts an Arabic verification page renders
RTL against a running instance.

## Adding a language

1. Copy `packages/i18n/src/locales/en.ts` to your language code.
2. Translate the values. The type is `Catalogue`, so a missing or misspelled key
   is a compile error rather than a raw key appearing on someone's credential.
3. Register it in `packages/i18n/src/index.ts`: add to `LOCALES`,
   `CATALOGUES`, `LOCALE_NAMES`, `LOCALE_REVIEW` and — if it is RTL —
   `RTL_LOCALES` and `FORMAT_TAGS`.
4. Run `npm run test -w @opencred/i18n`. The suite checks key coverage, that no
   value is empty, that `{placeholders}` survived translation, and that the file
   is not simply a copy of English.

## Testing it

```bash
npm run test -w @opencred/i18n      # 14 unit checks
node scripts/check-localisation.mjs # 27 checks against a running instance
```

The runtime check exists because a translation layer that silently falls back to
English looks identical to one that works — right up until a customer in São
Paulo opens it.

## Not done yet

**Delivery emails are English.** The template supports interpolation and the
catalogue has the strings, but there is no per-recipient locale to select with:
the issuer knows their cohort's language, we do not. The right fix is a default
locale on the organisation plus an optional per-recipient override, and it is
not built.

**The issuer dashboard is English.** It can adopt the same catalogue
incrementally. Shipping a language selector that translates a third of the
product would be worse than the honest gap.
