import { createHash } from 'node:crypto';
import { canonicalizeToBytes, jsonClone } from './jcs';
import { concatBytes, multibaseDecode58, multibaseEncode58 } from './encoding';
import { signBytes, verifyBytes } from './keys';
import { resolveVerificationMethod, type DocumentFetcher } from './did';

/**
 * FR-VER-02 — cryptographic integrity.
 *
 * W3C Data Integrity proofs using the `eddsa-jcs-2022` cryptosuite. The proof
 * is *detached* — it lives in the credential's `proof` member and covers every
 * other field — so altering any field of a downloaded credential JSON
 * invalidates it on re-verification, which is exactly the acceptance criterion.
 *
 * Signing input, per the cryptosuite spec:
 *
 *     SHA-256( JCS(proof config) )  ‖  SHA-256( JCS(document without proof) )
 *
 * Hashing the proof configuration separately and *first* is what binds the
 * signature to its own metadata. Without it, a signature made for
 * `proofPurpose: authentication` could be replayed as an `assertionMethod`
 * proof on the same document.
 */

export const CRYPTOSUITE = 'eddsa-jcs-2022';

export interface DataIntegrityProof {
  type: 'DataIntegrityProof';
  cryptosuite: string;
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  proofValue: string;
  '@context'?: unknown;
  expires?: string;
  domain?: string;
  challenge?: string;
  previousProof?: string;
}

export type SecuredDocument = Record<string, unknown> & {
  proof?: DataIntegrityProof | DataIntegrityProof[];
};

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(Buffer.from(bytes)).digest());
}

function hashingInput(
  unsecured: Record<string, unknown>,
  proofConfig: Record<string, unknown>,
): Uint8Array {
  return concatBytes(
    sha256(canonicalizeToBytes(proofConfig)),
    sha256(canonicalizeToBytes(unsecured)),
  );
}

function buildProofConfig(
  document: Record<string, unknown>,
  options: Omit<DataIntegrityProof, 'proofValue' | 'type' | 'cryptosuite'> &
    Partial<Pick<DataIntegrityProof, 'type' | 'cryptosuite'>>,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    type: options.type ?? 'DataIntegrityProof',
    cryptosuite: options.cryptosuite ?? CRYPTOSUITE,
    created: options.created,
    verificationMethod: options.verificationMethod,
    proofPurpose: options.proofPurpose,
  };
  if (options.expires) config.expires = options.expires;
  if (options.domain) config.domain = options.domain;
  if (options.challenge) config.challenge = options.challenge;
  if (options.previousProof) config.previousProof = options.previousProof;

  // The proof configuration inherits the document's context so that a proof
  // cannot be lifted onto a document that defines its terms differently.
  if (document['@context'] !== undefined) config['@context'] = document['@context'];
  return config;
}

export interface SignOptions {
  privateKeyBytes: Uint8Array;
  verificationMethod: string;
  proofPurpose?: string;
  created?: string;
  expires?: string;
  domain?: string;
  challenge?: string;
}

/** Add a detached `eddsa-jcs-2022` proof to a document. */
export function signDocument<T extends Record<string, unknown>>(
  document: T,
  options: SignOptions,
): T & { proof: DataIntegrityProof } {
  const { proof: _existing, ...unsecuredRest } = document as SecuredDocument;
  const unsecured = jsonClone(unsecuredRest) as Record<string, unknown>;

  const proofConfig = buildProofConfig(unsecured, {
    created: options.created ?? new Date().toISOString(),
    verificationMethod: options.verificationMethod,
    proofPurpose: options.proofPurpose ?? 'assertionMethod',
    expires: options.expires,
    domain: options.domain,
    challenge: options.challenge,
  });

  const signature = signBytes(options.privateKeyBytes, hashingInput(unsecured, proofConfig));

  // `@context` belongs to the proof configuration for hashing purposes only; it
  // is not serialised into the emitted proof object.
  const { '@context': _ctx, ...emitted } = proofConfig;

  return {
    ...(unsecured as T),
    proof: { ...(emitted as unknown as DataIntegrityProof), proofValue: multibaseEncode58(signature) },
  };
}

export interface ProofVerification {
  verified: boolean;
  errors: string[];
  /** The controller (issuer DID) the proof actually resolves to, when known. */
  controller?: string;
  verificationMethod?: string;
}

export interface VerifyProofOptions {
  /** Supply to resolve `did:web` verification methods over HTTPS. */
  fetchDocument?: DocumentFetcher;
  /**
   * Skip resolution and verify against a key the caller already trusts. This is
   * the hot path for our own verification endpoint, which holds the issuer key
   * locally and must answer in well under the p95 500 ms budget (§9.1).
   */
  publicKeyBytes?: Uint8Array;
  expectedProofPurpose?: string;
  /** Reject proofs whose `created` is in the future beyond this skew. */
  maxClockSkewSeconds?: number;
}

export async function verifyDocument(
  document: SecuredDocument,
  options: VerifyProofOptions = {},
): Promise<ProofVerification> {
  const errors: string[] = [];
  const proofs = Array.isArray(document.proof)
    ? document.proof
    : document.proof
      ? [document.proof]
      : [];

  if (proofs.length === 0) {
    return { verified: false, errors: ['credential carries no proof'] };
  }

  // A credential may legitimately carry several proofs (for example after key
  // rotation). One valid proof of the right purpose is enough; we report the
  // reasons the others failed so a debugging issuer can see them.
  let controller: string | undefined;
  let usedMethod: string | undefined;

  for (const proof of proofs) {
    const label = proof.verificationMethod ?? '(no verificationMethod)';
    try {
      if (proof.type !== 'DataIntegrityProof') {
        errors.push(`${label}: unsupported proof type "${proof.type}"`);
        continue;
      }
      if (proof.cryptosuite !== CRYPTOSUITE) {
        errors.push(`${label}: unsupported cryptosuite "${proof.cryptosuite}"`);
        continue;
      }
      const expectedPurpose = options.expectedProofPurpose ?? 'assertionMethod';
      if (proof.proofPurpose !== expectedPurpose) {
        errors.push(
          `${label}: proof purpose "${proof.proofPurpose}" does not match expected "${expectedPurpose}"`,
        );
        continue;
      }
      if (proof.expires && new Date(proof.expires).getTime() < Date.now()) {
        errors.push(`${label}: proof expired at ${proof.expires}`);
        continue;
      }
      const skew = (options.maxClockSkewSeconds ?? 300) * 1000;
      if (proof.created && new Date(proof.created).getTime() > Date.now() + skew) {
        errors.push(`${label}: proof created in the future (${proof.created})`);
        continue;
      }

      const { proof: _drop, ...unsecuredRest } = document;
      const unsecured = jsonClone(unsecuredRest) as Record<string, unknown>;
      const { proofValue, ...configSource } = proof;
      const proofConfig = buildProofConfig(unsecured, configSource);

      const publicKeyBytes =
        options.publicKeyBytes ??
        (await resolveVerificationMethod(proof.verificationMethod, options.fetchDocument))
          .publicKeyBytes;

      const ok = verifyBytes(
        publicKeyBytes,
        hashingInput(unsecured, proofConfig),
        multibaseDecode58(proofValue),
      );

      if (ok) {
        return {
          verified: true,
          errors: [],
          controller: proof.verificationMethod.split('#')[0],
          verificationMethod: proof.verificationMethod,
        };
      }
      errors.push(`${label}: signature does not match the credential contents`);
      controller ??= proof.verificationMethod.split('#')[0];
      usedMethod ??= proof.verificationMethod;
    } catch (err) {
      errors.push(`${label}: ${(err as Error).message}`);
    }
  }

  return { verified: false, errors, controller, verificationMethod: usedMethod };
}

/**
 * Content hash of a credential, independent of its proof.
 *
 * This is what gets anchored in Phase 2 (§9.3) and what the verification page
 * shows as the tamper-evident fingerprint. Deriving it from the canonical form
 * means two byte-different but semantically identical serialisations of the
 * same credential hash identically — a re-download must not change it.
 */
export function credentialHash(document: SecuredDocument): string {
  const { proof: _drop, ...rest } = document;
  return `sha256-${Buffer.from(sha256(canonicalizeToBytes(jsonClone(rest)))).toString('hex')}`;
}
