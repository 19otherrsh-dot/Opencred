import { createSign } from 'node:crypto';

/**
 * Google Wallet passes (FR-STD-04).
 *
 * A Google Wallet pass is delivered as a "save link": a JWT, signed with the
 * issuer's service-account key, that carries the pass object inline. Tapping it
 * adds the pass. There is no upload step and no binary format, which makes this
 * half of FR-STD-04 fully implementable and fully testable here — unlike Apple,
 * which needs a certificate only Apple can issue.
 *
 * The `GenericObject` class is the right shape for a credential. The
 * alternatives (`EventTicket`, `Offer`, `LoyaltyObject`) all carry semantics
 * that would be wrong on a diploma.
 */

export interface GoogleWalletConfig {
  /** Service-account email, from the JSON key file. */
  issuerEmail: string;
  /** PEM private key, from the JSON key file's `private_key`. */
  privateKey: string;
  /** Numeric issuer ID from the Google Wallet console. */
  issuerId: string;
  /**
   * The class this pass belongs to. Google requires a class to exist before a
   * pass referencing it can be saved; create it once via their API or console.
   */
  classId: string;
  /** Origins permitted to host the save link. */
  origins?: string[];
}

export interface CredentialPassInput {
  publicId: string;
  title: string;
  description?: string | null;
  recipientName: string;
  issuerName: string;
  issuedAt: string;
  expiresAt?: string | null;
  status: 'issued' | 'expired' | 'revoked' | 'draft';
  verificationUrl: string;
  /** Publicly reachable image URL. Google fetches it; a data URI will not do. */
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  /** Hex colour for the pass background. */
  backgroundColor?: string;
  /** Extra rows shown on the pass, such as grade or credit hours. */
  details?: Array<{ label: string; value: string }>;
}

function isoToGoogleDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build the `GenericObject` for a credential.
 *
 * Exported separately from the JWT so it can be inspected, diffed and tested
 * without a signing key.
 */
export function buildGoogleWalletObject(
  config: Pick<GoogleWalletConfig, 'issuerId' | 'classId'>,
  credential: CredentialPassInput,
): Record<string, unknown> {
  // Google requires the id to be prefixed with the issuer id, and to contain
  // only alphanumerics, dots, underscores and hyphens.
  const objectId = `${config.issuerId}.${credential.publicId.replace(/[^\w.-]/g, '')}`;

  const rows = (credential.details ?? []).slice(0, 6).map((detail, index) => ({
    id: `detail_${index}`,
    header: detail.label,
    body: detail.value,
  }));

  return {
    id: objectId,
    classId: config.classId,
    // A revoked or expired credential is still *saved* in the wallet; marking
    // it inactive is how the holder sees that it no longer counts, rather than
    // it silently continuing to look valid.
    state: credential.status === 'issued' ? 'ACTIVE' : 'INACTIVE',

    cardTitle: { defaultValue: { language: 'en', value: credential.issuerName } },
    header: { defaultValue: { language: 'en', value: credential.title } },
    subheader: { defaultValue: { language: 'en', value: credential.recipientName } },

    ...(credential.logoUrl
      ? {
          logo: {
            sourceUri: { uri: credential.logoUrl },
            contentDescription: {
              defaultValue: { language: 'en', value: `${credential.issuerName} logo` },
            },
          },
        }
      : {}),

    ...(credential.heroImageUrl
      ? { heroImage: { sourceUri: { uri: credential.heroImageUrl } } }
      : {}),

    hexBackgroundColor: credential.backgroundColor ?? '#1d4ed8',

    // The barcode encodes the verification URL, so scanning the pass off a
    // phone screen reaches the same page as scanning the printed certificate.
    barcode: {
      type: 'QR_CODE',
      value: credential.verificationUrl,
      alternateText: credential.publicId,
    },

    validTimeInterval: {
      start: { date: isoToGoogleDate(credential.issuedAt) },
      ...(credential.expiresAt ? { end: { date: isoToGoogleDate(credential.expiresAt) } } : {}),
    },

    textModulesData: [
      ...rows,
      {
        id: 'credential_id',
        header: 'Credential ID',
        body: credential.publicId,
      },
    ],

    linksModuleData: {
      uris: [
        {
          uri: credential.verificationUrl,
          description: 'Verify this credential',
          id: 'verification',
        },
      ],
    },
  };
}

/**
 * Produce the `https://pay.google.com/gp/v/save/<jwt>` link.
 *
 * The JWT is RS256 over the service-account key. Node's `crypto` signs this
 * natively, so there is no JWT library in the dependency tree.
 */
export function createGoogleWalletSaveUrl(
  config: GoogleWalletConfig,
  credential: CredentialPassInput,
): string {
  const object = buildGoogleWalletObject(config, credential);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: config.issuerEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: config.origins ?? [],
    payload: { genericObjects: [object] },
  };

  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

  const signingInput = `${encode(header)}.${encode(payload)}`;

  const signature = createSign('RSA-SHA256')
    .update(signingInput, 'utf8')
    .sign(config.privateKey)
    .toString('base64url');

  return `https://pay.google.com/gp/v/save/${signingInput}.${signature}`;
}

/** True when the configuration is complete enough to generate a pass. */
export function isGoogleWalletConfigured(
  config: Partial<GoogleWalletConfig> | null | undefined,
): config is GoogleWalletConfig {
  return Boolean(
    config?.issuerEmail && config?.privateKey && config?.issuerId && config?.classId,
  );
}
