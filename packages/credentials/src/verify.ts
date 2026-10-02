import { verifyDocument, credentialHash, type SecuredDocument } from './data-integrity';
import type { DocumentFetcher } from './did';
import { checkStatus, type StatusListCredential, type StatusListEntry } from './status-list';
import { validateAchievementCredential, type AchievementCredential } from './openbadges';

/**
 * FR-VER-03 — offline-capable verification of a credential document.
 *
 * This runs against a credential JSON someone hands us, with no database
 * lookup. It is what powers `POST /v1/public/verify` and the standalone
 * `opencred verify` CLI, and it is the reason a credential issued by OpenCred
 * remains checkable even if OpenCred, the vendor, ceases to exist — which is
 * the honest version of the permanence claim the blockchain-first vendors make.
 */

export interface CredentialVerificationChecks {
  structure: { ok: boolean; errors: string[] };
  signature: { ok: boolean; errors: string[]; issuerDid?: string; verificationMethod?: string };
  validity: { ok: boolean; errors: string[]; notYetValid: boolean; expired: boolean };
  status: { ok: boolean; checked: boolean; revoked: boolean; suspended: boolean; errors: string[] };
}

export interface CredentialVerificationResult {
  verified: boolean;
  hash: string;
  checks: CredentialVerificationChecks;
  errors: string[];
  verifiedAt: string;
}

export interface VerifyCredentialOptions {
  /** Resolves `did:web` DID documents. Omit to verify with a supplied key only. */
  fetchDocument?: DocumentFetcher;
  /** Resolves `statusListCredential` URLs. Omit to skip the status check. */
  fetchStatusList?: (url: string) => Promise<StatusListCredential>;
  /** Verify against a locally trusted key instead of resolving the DID. */
  publicKeyBytes?: Uint8Array;
  /** Treat a status list we cannot fetch as a failure rather than "unchecked". */
  requireStatusCheck?: boolean;
  now?: Date;
}

export async function verifyCredential(
  document: SecuredDocument,
  options: VerifyCredentialOptions = {},
): Promise<CredentialVerificationResult> {
  const now = options.now ?? new Date();
  const credential = document as unknown as AchievementCredential;

  const structureErrors = validateAchievementCredential(credential);
  const structure = { ok: structureErrors.length === 0, errors: structureErrors };

  const proofResult = await verifyDocument(document, {
    fetchDocument: options.fetchDocument,
    publicKeyBytes: options.publicKeyBytes,
  });
  const signature = {
    ok: proofResult.verified,
    errors: proofResult.errors,
    issuerDid: proofResult.controller,
    verificationMethod: proofResult.verificationMethod,
  };

  // The proof binds the issuer DID; the credential also *claims* one. If they
  // disagree, the signature is real but it was not made by the stated issuer —
  // the exact shape of a credential lifted from one issuer onto another.
  const claimedIssuer =
    typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id;
  if (signature.ok && claimedIssuer && proofResult.controller && claimedIssuer !== proofResult.controller) {
    signature.ok = false;
    signature.errors.push(
      `credential claims issuer ${claimedIssuer} but is signed by ${proofResult.controller}`,
    );
  }

  const validityErrors: string[] = [];
  const validFrom = credential.validFrom ? Date.parse(credential.validFrom) : NaN;
  const validUntil = credential.validUntil ? Date.parse(credential.validUntil) : null;
  const notYetValid = Number.isFinite(validFrom) && validFrom > now.getTime();
  const expired = validUntil !== null && Number.isFinite(validUntil) && validUntil < now.getTime();
  if (notYetValid) validityErrors.push(`credential is not valid until ${credential.validFrom}`);
  if (expired) validityErrors.push(`credential expired on ${credential.validUntil}`);
  const validity = { ok: validityErrors.length === 0, errors: validityErrors, notYetValid, expired };

  const statusEntries: StatusListEntry[] = credential.credentialStatus
    ? Array.isArray(credential.credentialStatus)
      ? credential.credentialStatus
      : [credential.credentialStatus]
    : [];

  const status = {
    ok: true,
    checked: false,
    revoked: false,
    suspended: false,
    errors: [] as string[],
  };

  for (const entry of statusEntries) {
    if (entry.type !== 'BitstringStatusListEntry') {
      status.errors.push(`unsupported credentialStatus type "${entry.type}"`);
      continue;
    }
    if (!options.fetchStatusList) {
      if (options.requireStatusCheck) {
        status.ok = false;
        status.errors.push('status list check required but no resolver was supplied');
      }
      continue;
    }
    try {
      const list = await options.fetchStatusList(entry.statusListCredential);
      const result = checkStatus(list, entry);
      status.checked = true;
      if (result.set) {
        if (result.purpose === 'revocation') status.revoked = true;
        else status.suspended = true;
        status.ok = false;
        status.errors.push(`credential is ${result.purpose === 'revocation' ? 'revoked' : 'suspended'}`);
      }
    } catch (err) {
      status.errors.push(`status list check failed: ${(err as Error).message}`);
      if (options.requireStatusCheck) status.ok = false;
    }
  }

  const checks: CredentialVerificationChecks = { structure, signature, validity, status };
  const errors = [
    ...structure.errors,
    ...signature.errors,
    ...validity.errors,
    ...status.errors,
  ];

  return {
    verified: structure.ok && signature.ok && validity.ok && status.ok,
    hash: credentialHash(document),
    checks,
    errors,
    verifiedAt: now.toISOString(),
  };
}
