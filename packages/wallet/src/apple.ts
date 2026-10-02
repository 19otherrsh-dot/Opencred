import { createHash } from 'node:crypto';
import { createZip, type ZipEntry } from './zip';
import type { CredentialPassInput } from './google';

/**
 * Apple Wallet passes (FR-STD-04).
 *
 * A `.pkpass` is a ZIP containing `pass.json`, images, a `manifest.json` of
 * SHA-1 hashes, and `signature` — a detached PKCS#7 signature over the manifest,
 * made with a Pass Type ID certificate that only Apple issues.
 *
 * Everything up to the signature is built and tested here. The signature is
 * behind the `PassSigner` interface because it cannot be produced without that
 * certificate, and pretending otherwise would ship a file that silently fails to
 * install. See `NodeOpenSslPassSigner` for the standard implementation and
 * `docs/wallet-passes.md` for what an operator has to obtain.
 */

export interface ApplePassConfig {
  /** `pass.apple.pass-type-id` from the Apple Developer portal. */
  passTypeIdentifier: string;
  /** The 10-character Apple Team ID. */
  teamIdentifier: string;
  /** Shown in Wallet's pass list. */
  organizationName: string;
  /** Hex background colour; converted to the `rgb(r, g, b)` Apple expects. */
  backgroundColor?: string;
  foregroundColor?: string;
  labelColor?: string;
  /**
   * Pass images. Apple requires at least `icon.png` (29pt) and `icon@2x.png`;
   * a pass without them is rejected by Wallet without explanation.
   */
  images: PassImages;
}

export interface PassImages {
  'icon.png': Buffer;
  'icon@2x.png'?: Buffer;
  'logo.png'?: Buffer;
  'logo@2x.png'?: Buffer;
  'strip.png'?: Buffer;
  'strip@2x.png'?: Buffer;
  'thumbnail.png'?: Buffer;
  'thumbnail@2x.png'?: Buffer;
  'background.png'?: Buffer;
  'background@2x.png'?: Buffer;
}

/**
 * Signs the manifest, producing the detached PKCS#7 `signature` file.
 *
 * Implementations need the Pass Type ID certificate, its private key, and the
 * Apple WWDR intermediate. This is an interface rather than a function so an
 * operator can hold the key in an HSM or a signing service instead of on disk.
 */
export interface PassSigner {
  sign(manifest: Buffer): Promise<Buffer>;
}

function hexToRgb(hex: string | undefined, fallback: string): string {
  if (!hex) return fallback;
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!match) return fallback;
  const [, r, g, b] = match;
  return `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`;
}

/**
 * Build `pass.json`.
 *
 * A credential is a `generic` pass. Apple's other styles encode travel or
 * retail semantics — `eventTicket` expires, `storeCard` implies a balance —
 * none of which describe a qualification someone earned.
 */
export function buildApplePassJson(
  config: ApplePassConfig,
  credential: CredentialPassInput,
  webServiceUrl?: string,
  authenticationToken?: string,
): Record<string, unknown> {
  const secondaryFields: Array<Record<string, unknown>> = [
    {
      key: 'issuer',
      label: 'Issued by',
      value: credential.issuerName,
    },
    {
      key: 'issued',
      label: 'Issued',
      value: credential.issuedAt,
      dateStyle: 'PKDateStyleMedium',
    },
  ];

  const auxiliaryFields: Array<Record<string, unknown>> = [];

  if (credential.expiresAt) {
    auxiliaryFields.push({
      key: 'expires',
      label: 'Expires',
      value: credential.expiresAt,
      dateStyle: 'PKDateStyleMedium',
    });
  }

  for (const [index, detail] of (credential.details ?? []).slice(0, 3).entries()) {
    auxiliaryFields.push({
      key: `detail_${index}`,
      label: detail.label,
      value: detail.value,
    });
  }

  const backFields: Array<Record<string, unknown>> = [
    {
      key: 'credential_id',
      label: 'Credential ID',
      value: credential.publicId,
    },
    {
      key: 'verify',
      label: 'Verify',
      // Apple linkifies URLs on the back of a pass, so the holder can reach the
      // public verification page without retyping the ID.
      value: credential.verificationUrl,
    },
  ];

  if (credential.description) {
    backFields.unshift({
      key: 'description',
      label: 'About this credential',
      value: credential.description,
    });
  }

  if (credential.status !== 'issued') {
    // Wallet has no "revoked" state, so say it in a field rather than let a
    // revoked credential keep presenting as good.
    backFields.unshift({
      key: 'status',
      label: 'Status',
      value: credential.status === 'revoked' ? 'Revoked' : 'No longer valid',
    });
  }

  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeIdentifier,
    teamIdentifier: config.teamIdentifier,
    organizationName: config.organizationName,
    serialNumber: credential.publicId,
    description: credential.title,

    backgroundColor: hexToRgb(config.backgroundColor, 'rgb(29, 78, 216)'),
    foregroundColor: hexToRgb(config.foregroundColor, 'rgb(255, 255, 255)'),
    labelColor: hexToRgb(config.labelColor, 'rgb(219, 234, 254)'),

    ...(credential.expiresAt ? { expirationDate: credential.expiresAt } : {}),
    // A revoked pass is dimmed in Wallet rather than removed; the holder keeps
    // the record but nobody can present it as current.
    ...(credential.status === 'revoked' ? { voided: true } : {}),

    ...(webServiceUrl && authenticationToken
      ? { webServiceURL: webServiceUrl, authenticationToken }
      : {}),

    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: credential.verificationUrl,
        messageEncoding: 'iso-8859-1',
        altText: credential.publicId,
      },
    ],

    generic: {
      headerFields: [],
      primaryFields: [
        {
          key: 'title',
          label: 'Credential',
          value: credential.title,
        },
      ],
      secondaryFields: [
        {
          key: 'recipient',
          label: 'Awarded to',
          value: credential.recipientName,
        },
        ...secondaryFields,
      ],
      auxiliaryFields,
      backFields,
    },
  };
}

/**
 * Hash every file in the bundle. Apple mandates SHA-1 here — not a choice, and
 * not a security boundary: the signature over this manifest is what's trusted.
 */
export function buildManifest(entries: ZipEntry[]): Buffer {
  const manifest: Record<string, string> = {};
  for (const entry of entries) {
    manifest[entry.name] = createHash('sha1').update(entry.data).digest('hex');
  }
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}

export interface PkPassResult {
  bundle: Buffer;
  /** Filenames in the archive, in order. */
  entries: string[];
  /** True when a real signature was applied. */
  signed: boolean;
}

/**
 * Assemble a `.pkpass`.
 *
 * With no signer the archive is built and returned with `signed: false` and an
 * empty `signature`. Wallet will refuse to install it — which is correct. It
 * exists so the bundle can be inspected and tested without Apple credentials,
 * and callers are expected to check `signed` before offering a download.
 */
export async function createPkPass(
  config: ApplePassConfig,
  credential: CredentialPassInput,
  options: {
    signer?: PassSigner;
    webServiceUrl?: string;
    authenticationToken?: string;
  } = {},
): Promise<PkPassResult> {
  const passJson = buildApplePassJson(
    config,
    credential,
    options.webServiceUrl,
    options.authenticationToken,
  );

  const payload: ZipEntry[] = [
    { name: 'pass.json', data: Buffer.from(JSON.stringify(passJson, null, 2), 'utf8') },
  ];

  for (const [name, data] of Object.entries(config.images)) {
    if (data && data.length > 0) payload.push({ name, data });
  }

  const manifest = buildManifest(payload);
  const signature = options.signer ? await options.signer.sign(manifest) : Buffer.alloc(0);

  const entries: ZipEntry[] = [
    ...payload,
    { name: 'manifest.json', data: manifest },
    { name: 'signature', data: signature },
  ];

  return {
    bundle: createZip(entries),
    entries: entries.map((entry) => entry.name),
    signed: signature.length > 0,
  };
}

/**
 * The standard signer: OpenSSL's PKCS#7 in detached, binary (DER) form.
 *
 * This shells out because Node's `crypto` has no PKCS#7/CMS support — there is
 * no way to produce this signature with the standard library alone. Kept out of
 * the default path so the package still installs and tests where OpenSSL is
 * absent, which includes plenty of Windows machines.
 */
export class NodeOpenSslPassSigner implements PassSigner {
  constructor(
    private readonly paths: {
      /** Pass Type ID certificate, PEM. */
      certificatePath: string;
      /** Its private key, PEM. */
      keyPath: string;
      /** Apple WWDR intermediate certificate, PEM. */
      wwdrPath: string;
      keyPassphrase?: string;
      /** Defaults to `openssl` on PATH. */
      opensslPath?: string;
    },
  ) {}

  async sign(manifest: Buffer): Promise<Buffer> {
    const { spawn } = await import('node:child_process');
    const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'opencred-pkpass-'));
    const manifestPath = join(dir, 'manifest.json');
    const outputPath = join(dir, 'signature');

    try {
      await writeFile(manifestPath, manifest);

      const args = [
        'smime',
        '-binary',
        '-sign',
        '-certfile',
        this.paths.wwdrPath,
        '-signer',
        this.paths.certificatePath,
        '-inkey',
        this.paths.keyPath,
        '-in',
        manifestPath,
        '-out',
        outputPath,
        '-outform',
        'DER',
        // Wallet rejects a signature carrying a signing-time attribute that
        // disagrees with the certificate's validity window; omitting it avoids
        // a class of failures that surface only as "cannot install".
        '-noattr',
      ];

      if (this.paths.keyPassphrase) {
        args.push('-passin', `pass:${this.paths.keyPassphrase}`);
      }

      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.paths.opensslPath ?? 'openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
          stderr += String(chunk);
        });
        child.on('error', (error) =>
          reject(new Error(`OpenSSL is required to sign Apple Wallet passes: ${error.message}`)),
        );
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`OpenSSL exited ${code}: ${stderr.trim()}`));
        });
      });

      return await readFile(outputPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** True when the configuration is complete enough to build a pass. */
export function isApplePassConfigured(
  config: Partial<ApplePassConfig> | null | undefined,
): config is ApplePassConfig {
  return Boolean(
    config?.passTypeIdentifier &&
      config?.teamIdentifier &&
      config?.organizationName &&
      config?.images?.['icon.png'],
  );
}
