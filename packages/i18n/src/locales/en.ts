/**
 * English message catalogue — the source of truth.
 *
 * Every other locale is typed against this object, so a missing or misspelled
 * key is a compile error rather than a string that silently renders as
 * `verification.title` on somebody's credential page.
 *
 * Scope note: this covers the *recipient-facing* surfaces — the verification
 * page, the delivery email, the wallet, and the credential-not-found page.
 * Those are the ones a recipient in São Paulo or an employer in Mumbai actually
 * opens. The issuer dashboard is English-only for now and can adopt the same
 * catalogue incrementally; pretending otherwise in a language selector would be
 * worse than the honest gap.
 *
 * Interpolation uses `{name}` placeholders. There is no pluralisation engine:
 * where a count matters, the message takes a pre-formatted string, because a
 * half-correct plural rule across six languages is worse than none.
 */
export const en = {
  // --- Verification page ---------------------------------------------------
  'verify.valid.title': 'This credential is valid',
  'verify.valid.subtitle': 'Issued by {issuer} and cryptographically verified just now.',
  'verify.revoked.title': 'This credential has been revoked',
  'verify.revoked.subtitle': '{issuer} revoked this credential on {date}.',
  'verify.revoked.subtitleNoDate': '{issuer} revoked this credential.',
  'verify.expired.title': 'This credential has expired',
  'verify.expired.subtitle': 'It was valid until {date}.',
  'verify.invalid.title': 'This credential could not be verified',
  'verify.invalid.subtitle': 'The signature did not match the credential contents.',

  'verify.section.credential': 'Credential',
  'verify.field.awardedTo': 'Awarded to',
  'verify.field.issuedBy': 'Issued by',
  'verify.field.issueDate': 'Issue date',
  'verify.field.validUntil': 'Valid until',
  'verify.field.expired': 'Expired',
  'verify.field.revoked': 'Revoked',
  'verify.field.credentialId': 'Credential ID',

  'verify.checks.title': 'What was checked',
  'verify.checks.subtitle': 'Verified {timestamp}. These checks run on every visit, not once at issuance.',
  'verify.checks.signature': 'Digital signature',
  'verify.checks.signatureDetail': 'the credential has not been altered since it was issued',
  'verify.checks.issuer': 'Issuer identity',
  'verify.checks.issuerDetail': 'the signing key belongs to the named issuer',
  'verify.checks.issuerDetailDid': 'signed by {did}',
  'verify.checks.revocation': 'Revocation status',
  'verify.checks.revocationDetail': "checked against the issuer's published revocation list",
  'verify.checks.validity': 'Validity period',
  'verify.checks.validityDetail': 'expires {date}',
  'verify.checks.validityDetailNever': 'this credential does not expire',
  'verify.checks.anchor': 'External timestamp anchor',
  'verify.checks.anchorDetail': 'optional; this issuer has not enabled anchoring',
  'verify.checks.passed': 'passed',
  'verify.checks.failed': 'failed',
  'verify.checks.notChecked': 'not checked',

  'verify.errors.title': 'Why this failed',

  'verify.action.download': 'Download',
  'verify.action.share': 'Share',
  'verify.action.shareCopied': 'Link copied',
  'verify.action.addToLinkedIn': 'Add to LinkedIn profile',
  // Apple and Google both publish exact wording for these buttons and both
  // treat it as a trademark matter, so they are not translated freely: the
  // platform name stays as the platform writes it.
  'verify.action.addToAppleWallet': 'Add to Apple Wallet',
  'verify.action.addToGoogleWallet': 'Add to Google Wallet',
  'verify.action.viewJson': 'View the signed JSON',
  'verify.action.verifyAnother': 'Verify another credential',

  'verify.developers.title': 'For developers and employers',
  'verify.developers.body':
    'This credential is an Open Badges 3.0 / W3C Verifiable Credential. You can verify it yourself, with any conformant verifier, without going through this page.',
  'verify.developers.jsonLink': 'Signed credential JSON',
  'verify.developers.issuerDid': 'Issuer DID',

  'verify.contact': 'Questions about this credential? Contact {email}.',
  'verify.poweredBy':
    'Issued with OpenCred, the open-source credentialing platform. Anyone can run it, and anyone can audit it.',

  // --- Not found -----------------------------------------------------------
  'notFound.title': 'No credential with that identifier',
  'notFound.subtitle': 'Nothing has ever been issued under this ID by this issuer.',
  'notFound.reasons': 'There are two common reasons for this:',
  'notFound.typo.label': 'A typo.',
  'notFound.typo.body':
    'Credential IDs never contain the digits 0 or 1, or the letters o, i or l — those are excluded precisely because they are misread. Check the ID against the certificate and try again.',
  'notFound.forged.label': 'The credential is not genuine.',
  'notFound.forged.body':
    'If the ID was copied exactly from a document and still does not resolve, that document was not issued through this platform.',
  'notFound.tryAnother': 'Try another ID',

  // --- Wallet --------------------------------------------------------------
  'wallet.title': 'Your credentials',
  'wallet.intro':
    'Every certificate and badge ever issued to your email address, from every organisation, in one place.',
  'wallet.emailLabel': 'Your email address',
  'wallet.emailHint': 'The address your credentials were sent to. No password needed.',
  'wallet.requestLink': 'Email me a sign-in link',
  'wallet.checkInbox': 'Check your inbox',
  'wallet.checkInboxBody':
    'If {email} has received any credentials, a sign-in link is on its way. It is valid for 30 minutes.',
  'wallet.privacyNote':
    'We deliberately do not say whether an address has credentials — that would let anyone probe who holds what.',
  'wallet.empty': 'Nothing has been issued to this address on this installation yet.',
  'wallet.count': '{count} issued to {email}',
  'wallet.issuedOn': 'Issued {date}',
  'wallet.expiresOn': 'expires {date}',
  'wallet.action.verificationPage': 'Verification page',
  'wallet.theseAreYours': 'These are yours',
  'wallet.theseAreYoursBody':
    'Each credential is a signed, portable document. You can download the JSON and keep it, or hand it to any conformant verifier — it stays checkable even if the issuing organisation stops using this platform.',
  'wallet.signOut': 'Sign out',

  // --- Delivery email ------------------------------------------------------
  'email.download': 'Download your credential',
  'email.viewVerification': 'View the public verification page',
  'email.addToLinkedIn': 'Add to your LinkedIn profile',
  'email.viewAll': 'See all your credentials',
  'email.assurance':
    'This credential is cryptographically signed. Anyone can confirm it is genuine at the verification link above — no account required.',
  'email.issuedWith': 'Issued with OpenCred, the open-source credentialing platform.',

  // --- Status --------------------------------------------------------------
  'status.valid': 'Valid',
  'status.expired': 'Expired',
  'status.revoked': 'Revoked',
  'status.processing': 'Processing',
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<MessageKey, string>;
