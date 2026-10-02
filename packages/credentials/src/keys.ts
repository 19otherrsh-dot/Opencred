import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from 'node:crypto';
import {
  MULTICODEC,
  concatBytes,
  multibaseDecode58,
  multibaseEncode58,
  stripPrefix,
  withPrefix,
} from './encoding';

/**
 * Ed25519 issuer keys.
 *
 * Node's built-in Ed25519 support is used directly — no third-party crypto
 * library sits between an issuer's private key and the signature. FIPS-ish
 * curve debates aside, Ed25519 is what the Open Badges 3.0 and W3C VC Data
 * Integrity ecosystems actually interoperate on, and it is what the 1EdTech
 * conformance suite exercises.
 */

// DER wrappers for raw Ed25519 keys. Fixed-length and fixed-shape, so a byte
// prefix is both correct and considerably clearer than an ASN.1 dependency.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface Ed25519KeyPair {
  /** `z…` multibase Multikey encoding of the public key. */
  publicKeyMultibase: string;
  /** `z…` multibase Multikey encoding of the private key. Treat as a secret. */
  privateKeyMultibase: string;
  publicKeyBytes: Uint8Array;
  privateKeyBytes: Uint8Array;
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyBytes = rawPublicKey(publicKey);
  const privateKeyBytes = rawPrivateKey(privateKey);
  return {
    publicKeyBytes,
    privateKeyBytes,
    publicKeyMultibase: encodePublicKeyMultibase(publicKeyBytes),
    privateKeyMultibase: encodePrivateKeyMultibase(privateKeyBytes),
  };
}

export function rawPublicKey(key: KeyObject): Uint8Array {
  const der = key.export({ format: 'der', type: 'spki' }) as Buffer;
  return new Uint8Array(der.subarray(der.length - 32));
}

export function rawPrivateKey(key: KeyObject): Uint8Array {
  const der = key.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return new Uint8Array(der.subarray(der.length - 32));
}

export function publicKeyFromBytes(bytes: Uint8Array): KeyObject {
  if (bytes.length !== 32) throw new Error('Ed25519 public keys are 32 bytes');
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(bytes)]),
    format: 'der',
    type: 'spki',
  });
}

export function privateKeyFromBytes(bytes: Uint8Array): KeyObject {
  if (bytes.length !== 32) throw new Error('Ed25519 private key seeds are 32 bytes');
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(bytes)]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function encodePublicKeyMultibase(bytes: Uint8Array): string {
  return multibaseEncode58(withPrefix(MULTICODEC.ed25519Pub, bytes));
}

export function decodePublicKeyMultibase(value: string): Uint8Array {
  return stripPrefix(MULTICODEC.ed25519Pub, multibaseDecode58(value));
}

export function encodePrivateKeyMultibase(bytes: Uint8Array): string {
  return multibaseEncode58(withPrefix(MULTICODEC.ed25519Priv, bytes));
}

export function decodePrivateKeyMultibase(value: string): Uint8Array {
  return stripPrefix(MULTICODEC.ed25519Priv, multibaseDecode58(value));
}

export function signBytes(privateKeyBytes: Uint8Array, data: Uint8Array): Uint8Array {
  return new Uint8Array(nodeSign(null, Buffer.from(data), privateKeyFromBytes(privateKeyBytes)));
}

export function verifyBytes(
  publicKeyBytes: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return nodeVerify(
      null,
      Buffer.from(data),
      publicKeyFromBytes(publicKeyBytes),
      Buffer.from(signature),
    );
  } catch {
    // A malformed key or signature is a failed verification, not a crash — the
    // verify endpoint is public and takes attacker-controlled input.
    return false;
  }
}

/** `did:key` identifier for a public key. Used for recipient-held keys. */
export function didKeyFromPublicKey(publicKeyBytes: Uint8Array): string {
  return `did:key:${encodePublicKeyMultibase(publicKeyBytes)}`;
}

export function publicKeyFromDidKey(did: string): Uint8Array {
  if (!did.startsWith('did:key:')) throw new Error(`not a did:key identifier: ${did}`);
  return decodePublicKeyMultibase(did.slice('did:key:'.length));
}

export { concatBytes };
