import { gzipSync, gunzipSync } from 'node:zlib';
import { multibaseDecode64url, multibaseEncode64url } from './encoding';

/**
 * W3C Bitstring Status List v1.0 — revocation and suspension.
 *
 * FR-ISS-06 requires that revoking a batch immediately shows "Revoked" on every
 * affected verification page. Our own verification endpoint reads the database
 * and satisfies that on its own. The status list exists for the harder case:
 * a *third-party* verifier holding a downloaded credential JSON, who never
 * touches our UI, must be able to discover the revocation too. That is the
 * difference between a credential that is verifiable and one that merely looks
 * verifiable.
 *
 * Privacy note: the list is padded to 131,072 entries and indices are assigned
 * randomly rather than sequentially, both per the spec's herd-privacy guidance.
 * A sequential index would leak an issuer's issuance volume and ordering to
 * anyone who fetches the list.
 */

/** Spec minimum, and the size we always use. 131,072 bits = 16 KiB uncompressed. */
export const STATUS_LIST_SIZE = 131_072;

export type StatusPurpose = 'revocation' | 'suspension';

/**
 * Bit ordering: index 0 is the most significant bit of byte 0. This matches the
 * spec's bitstring expansion algorithm and the existing StatusList2021
 * implementations, so lists round-trip with other ecosystem tooling.
 */
function locate(index: number): { byte: number; mask: number } {
  if (!Number.isInteger(index) || index < 0 || index >= STATUS_LIST_SIZE) {
    throw new RangeError(`status list index ${index} out of range 0..${STATUS_LIST_SIZE - 1}`);
  }
  return { byte: index >> 3, mask: 0x80 >> (index & 7) };
}

export function createBitstring(): Uint8Array {
  return new Uint8Array(STATUS_LIST_SIZE / 8);
}

export function setBit(bits: Uint8Array, index: number, value: boolean): Uint8Array {
  const { byte, mask } = locate(index);
  if (value) bits[byte] |= mask;
  else bits[byte] &= ~mask & 0xff;
  return bits;
}

export function getBit(bits: Uint8Array, index: number): boolean {
  const { byte, mask } = locate(index);
  return (bits[byte] & mask) !== 0;
}

/** GZIP + multibase-base64url, the wire format of `encodedList`. */
export function encodeBitstring(bits: Uint8Array): string {
  return multibaseEncode64url(new Uint8Array(gzipSync(Buffer.from(bits), { level: 9 })));
}

export function decodeBitstring(encoded: string): Uint8Array {
  const raw = gunzipSync(Buffer.from(multibaseDecode64url(encoded)));
  if (raw.length * 8 < STATUS_LIST_SIZE) {
    throw new Error(`status list is shorter than the ${STATUS_LIST_SIZE}-entry minimum`);
  }
  return new Uint8Array(raw);
}

export interface StatusListCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: {
    id: string;
    type: 'BitstringStatusList';
    statusPurpose: StatusPurpose;
    encodedList: string;
    /** Optional TTL hint, in milliseconds, for verifier caches. */
    ttl?: number;
  };
  [key: string]: unknown;
}

export function buildStatusListCredential(params: {
  id: string;
  issuer: string;
  purpose: StatusPurpose;
  bits: Uint8Array;
  validFrom?: string;
  ttlMs?: number;
}): StatusListCredential {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: params.id,
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: params.issuer,
    validFrom: params.validFrom ?? new Date().toISOString(),
    credentialSubject: {
      id: `${params.id}#list`,
      type: 'BitstringStatusList',
      statusPurpose: params.purpose,
      encodedList: encodeBitstring(params.bits),
      ...(params.ttlMs ? { ttl: params.ttlMs } : {}),
    },
  };
}

export interface StatusListEntry {
  id: string;
  type: 'BitstringStatusListEntry';
  statusPurpose: StatusPurpose;
  statusListIndex: string;
  statusListCredential: string;
}

export function buildStatusEntry(params: {
  statusListCredentialUrl: string;
  index: number;
  purpose?: StatusPurpose;
}): StatusListEntry {
  return {
    id: `${params.statusListCredentialUrl}#${params.index}`,
    type: 'BitstringStatusListEntry',
    statusPurpose: params.purpose ?? 'revocation',
    statusListIndex: String(params.index),
    statusListCredential: params.statusListCredentialUrl,
  };
}

/** Read one entry's status out of a fetched status list credential. */
export function checkStatus(
  listCredential: StatusListCredential,
  entry: StatusListEntry,
): { set: boolean; purpose: StatusPurpose } {
  const subject = listCredential.credentialSubject;
  if (subject.statusPurpose !== entry.statusPurpose) {
    throw new Error(
      `status purpose mismatch: entry wants "${entry.statusPurpose}", list serves "${subject.statusPurpose}"`,
    );
  }
  const bits = decodeBitstring(subject.encodedList);
  return { set: getBit(bits, Number(entry.statusListIndex)), purpose: subject.statusPurpose };
}

/**
 * Pick an unused index at random rather than sequentially (herd privacy).
 *
 * The caller passes the indices already taken on this list. Collisions are
 * resolved by linear probing from the random start, which keeps assignment O(1)
 * in practice while the list is far from full; callers roll to a new list well
 * before then.
 */
export function allocateIndex(used: Set<number>): number {
  if (used.size >= STATUS_LIST_SIZE) {
    throw new Error('status list is full; allocate a new list');
  }
  let candidate = Math.floor(Math.random() * STATUS_LIST_SIZE);
  while (used.has(candidate)) candidate = (candidate + 1) % STATUS_LIST_SIZE;
  return candidate;
}
