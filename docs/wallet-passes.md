# Wallet passes (FR-STD-04)

A recipient can add a credential to Apple Wallet or Google Wallet from the
public verification page. Both are **off by default**, because both require the
person running the deployment to enrol with the platform first — there is no
version of this feature that works without an account at Apple or Google.

When neither is configured the buttons do not render. That is the correct state
for most self-hosted installs, and it is better than a button that leads to an
error.

## What each platform actually requires

The two are not symmetric, and it is worth knowing why before you start.

| | Google Wallet | Apple Wallet |
|---|---|---|
| Delivery | A signed JWT in a URL | A signed `.pkpass` ZIP |
| Credential needed | Service-account key | Pass Type ID certificate |
| Who issues it | You, in Google Cloud | Apple, per Apple Developer account |
| Cost | Free | Apple Developer Program, $99/yr |
| Signing | RS256 — Node does this natively | PKCS#7 — needs OpenSSL |
| Images | Google fetches them by URL | Embedded in the bundle as bytes |

Google is the cheaper one to turn on by a wide margin. If you are enabling one,
enable that one.

## Google Wallet

1. Enrol at [the Google Wallet console](https://pay.google.com/business/console)
   and note your **issuer ID** (a long number).
2. Create a service account in the same Google Cloud project, grant it the
   Wallet Object Issuer role, and download its JSON key.
3. Create the **Generic class** your passes belong to. Google requires the class
   to exist before any pass can reference it. Create it once, via their API or
   the console, with the id `<issuerId>.opencred_credential` — or whatever you
   set `WALLET_GOOGLE_CLASS_SUFFIX` to.
4. Configure:

```bash
WALLET_GOOGLE_ISSUER_ID=3388000000012345678
WALLET_GOOGLE_SERVICE_ACCOUNT_EMAIL=passes@your-project.iam.gserviceaccount.com
WALLET_GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n"
```

Paste the private key exactly as it appears in the JSON file, `\n` escapes and
all — they are converted to real newlines on load. This is the step people get
wrong, and OpenSSL's error when the key is malformed points nowhere useful.

### Images

Google fetches pass images from its own servers, so it needs a publicly
reachable URL rather than bytes. `GET /v1/public/credentials/:id/brand-logo.png`
exists for exactly this: it serves the issuer's uploaded brand logo, and it is
public because Google cannot present a credential of ours to fetch it. Only PNG
and JPEG logos are used; an SVG brand mark is skipped rather than converted.

## Apple Wallet

You need three files, in PEM:

1. **A Pass Type ID certificate.** Register a Pass Type ID in the Apple Developer
   portal, generate a CSR, and download the certificate Apple issues. Convert the
   `.cer` to PEM: `openssl x509 -inform DER -in pass.cer -out pass.pem`.
2. **Its private key** — the one whose CSR you submitted.
3. **The Apple WWDR intermediate certificate**, from Apple's certificate
   authority page, also converted to PEM.

```bash
WALLET_APPLE_PASS_TYPE_ID=pass.edu.example.credentials
WALLET_APPLE_TEAM_ID=ABCDE12345
WALLET_APPLE_CERT_PATH=/etc/opencred/apple/pass.pem
WALLET_APPLE_KEY_PATH=/etc/opencred/apple/pass.key
WALLET_APPLE_WWDR_PATH=/etc/opencred/apple/wwdr.pem
```

**OpenSSL must be on the PATH.** Signing a `.pkpass` means producing a detached
PKCS#7 signature, and Node's `crypto` module has no CMS/PKCS#7 support at all —
there is no way to do this with the standard library. The official Docker image
includes OpenSSL. A bare Windows host generally does not.

If signing fails the endpoint returns `503 wallet_signing_failed` rather than
handing back an unsigned bundle. An unsigned `.pkpass` installs nowhere and
produces a support ticket that reads "nothing happens when I tap it".

## Testing status

Worth being straight about what has and has not been exercised:

- **Google** — the pass object and the JWT are covered by tests, including
  verifying the signature back against the public key, so the save link is
  provably well-formed. It has not been tapped on a physical Android device.
- **Apple** — the `pass.json`, the SHA-1 manifest and the `.pkpass` ZIP are all
  covered by tests, and the archive round-trips through a standard unzip. The
  **signature path is untested**: it needs a Pass Type ID certificate, which only
  Apple issues. The OpenSSL invocation is exercised against a self-signed
  stand-in wherever OpenSSL is present, which proves the plumbing but not the
  chain of trust.

If you enrol and try this, the first thing to check is that `manifest.json`
lists every file in the bundle and that each hash matches. A manifest that
disagrees with the payload is the most common reason a pass silently refuses to
install.

## What ends up on the pass

Both passes carry the same content:

- The credential title, the recipient's name and the issuing organisation.
- A QR code encoding the public verification URL — so scanning the pass off a
  phone screen reaches the same page as scanning the printed certificate.
- Up to four merge fields (grade, credit hours, and so on). Only string and
  number values; a nested object rendered as `[object Object]` on someone's lock
  screen is worse than not showing the field.
- The credential ID, and a link to verification on the back.

A **revoked** credential still generates a pass, and this is deliberate. The
holder keeps the record; the pass is marked `INACTIVE` on Google and `voided` on
Apple, with the status stated on the back. Refusing to generate it would leave a
stale, still-valid-looking pass sitting in the wallet of anyone who added it
before the revocation.

## Privacy

The pass contains the recipient's name and the credential, and lives on their
device. Nothing about generating one is reported to us beyond the existing
`wallet_added` analytics event, which records that a pass was generated and for
which credential — the same event the LinkedIn button already records.

Google Wallet passes are stored on Google's servers by design: that is what a
save link does. Recipients in jurisdictions where that matters should use the
PDF, and issuers who would rather not offer the choice can simply leave the
Google configuration blank.
