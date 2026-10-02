import { decodePublicKeyMultibase, publicKeyFromDidKey } from './keys';

/**
 * FR-STD-03 — DID-based issuer identity, defaulting to `did:web`.
 *
 * `did:web` is the deliberate default because it needs no blockchain, no
 * registry fee and no third party: an issuer already controls a domain, and
 * `did:web:certs.example.edu` resolves to
 * `https://certs.example.edu/.well-known/did.json` over ordinary HTTPS. The
 * institution's existing TLS certificate is the root of trust.
 *
 * `did:cheqd` remains available for institutions that specifically want a
 * public ledger-anchored identity, but it is opt-in and never required.
 */

export interface VerificationMethod {
  id: string;
  type: 'Multikey';
  controller: string;
  publicKeyMultibase: string;
}

export interface DidDocument {
  '@context': string[];
  id: string;
  verificationMethod: VerificationMethod[];
  assertionMethod: string[];
  authentication: string[];
  service?: Array<{ id: string; type: string; serviceEndpoint: string }>;
  alsoKnownAs?: string[];
}

/**
 * Convert a public origin into a `did:web` identifier.
 *
 * Per the did:web method: the host is percent-decoded, `:` separates path
 * segments, and the default HTTPS port is omitted. A port, where present, is
 * encoded as `%3A` — which is why this is not a one-line string replace.
 */
export function didWebFromUrl(publicUrl: string, path?: string): string {
  const url = new URL(publicUrl);
  let id = url.hostname;
  if (url.port && url.port !== '443') id += `%3A${url.port}`;

  const segments = [
    ...url.pathname.split('/').filter(Boolean),
    ...(path ? path.split('/').filter(Boolean) : []),
  ];
  if (segments.length > 0) id += `:${segments.map(encodeURIComponent).join(':')}`;
  return `did:web:${id}`;
}

/** The HTTPS URL a `did:web` identifier resolves to. */
export function didWebToUrl(did: string): string {
  if (!did.startsWith('did:web:')) throw new Error(`not a did:web identifier: ${did}`);
  const [host, ...path] = did.slice('did:web:'.length).split(':');
  const hostname = decodeURIComponent(host);
  const decodedPath = path.map(decodeURIComponent);
  return decodedPath.length === 0
    ? `https://${hostname}/.well-known/did.json`
    : `https://${hostname}/${decodedPath.join('/')}/did.json`;
}

export function buildDidDocument(params: {
  did: string;
  publicKeyMultibase: string;
  /** Key fragment; `#key-1` by default so rotation can add `#key-2`. */
  keyId?: string;
  serviceEndpoint?: string;
  alsoKnownAs?: string[];
}): DidDocument {
  const keyId = params.keyId ?? 'key-1';
  const vmId = `${params.did}#${keyId}`;
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
    ],
    id: params.did,
    verificationMethod: [
      {
        id: vmId,
        type: 'Multikey',
        controller: params.did,
        publicKeyMultibase: params.publicKeyMultibase,
      },
    ],
    assertionMethod: [vmId],
    authentication: [vmId],
    ...(params.serviceEndpoint
      ? {
          service: [
            {
              id: `${params.did}#credential-service`,
              type: 'CredentialService',
              serviceEndpoint: params.serviceEndpoint,
            },
          ],
        }
      : {}),
    ...(params.alsoKnownAs ? { alsoKnownAs: params.alsoKnownAs } : {}),
  };
}

export interface ResolvedKey {
  controller: string;
  publicKeyBytes: Uint8Array;
  verificationMethodId: string;
}

export type DocumentFetcher = (url: string) => Promise<unknown>;

/**
 * Resolve a verification method to raw key bytes.
 *
 * `did:key` resolves purely arithmetically. `did:web` needs one HTTPS fetch,
 * supplied by the caller so that the API server (which has a cache and an
 * allow-list) and an offline CLI verifier can each supply their own.
 */
export async function resolveVerificationMethod(
  verificationMethodId: string,
  fetchDocument?: DocumentFetcher,
): Promise<ResolvedKey> {
  const did = verificationMethodId.split('#')[0];

  if (did.startsWith('did:key:')) {
    return {
      controller: did,
      publicKeyBytes: publicKeyFromDidKey(did),
      verificationMethodId,
    };
  }

  if (did.startsWith('did:web:')) {
    if (!fetchDocument) {
      throw new Error('resolving did:web requires a document fetcher');
    }
    const doc = (await fetchDocument(didWebToUrl(did))) as DidDocument | null;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.verificationMethod)) {
      throw new Error(`could not resolve DID document for ${did}`);
    }
    const method =
      doc.verificationMethod.find((m) => m.id === verificationMethodId) ??
      // A fragment-less reference means "the document's default assertion key".
      (verificationMethodId === did ? doc.verificationMethod[0] : undefined);
    if (!method) {
      throw new Error(`verification method ${verificationMethodId} not present in ${did}`);
    }
    if (method.controller !== did) {
      throw new Error(`verification method ${method.id} is not controlled by ${did}`);
    }
    return {
      controller: did,
      publicKeyBytes: decodePublicKeyMultibase(method.publicKeyMultibase),
      verificationMethodId: method.id,
    };
  }

  throw new Error(`unsupported DID method in ${verificationMethodId}`);
}
