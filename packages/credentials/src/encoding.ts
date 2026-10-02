/**
 * Multibase / multicodec encoding helpers.
 *
 * These are implemented here rather than pulled from a dependency for a
 * specific reason: they sit directly on the credential-signing path, and the
 * whole promise of this project is that a security team can audit the code that
 * protects their credentials. Sixty lines of base58 they can read beats a
 * transitive dependency tree they cannot.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP: Record<string, number> = {};
for (let i = 0; i < BASE58_ALPHABET.length; i += 1) BASE58_MAP[BASE58_ALPHABET[i]] = i;

export function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  // Leading zero bytes each become one '1' in the output.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const size = Math.ceil(((bytes.length - zeros) * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;

  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }

  let out = '1'.repeat(zeros);
  for (let i = size - length; i < size; i += 1) out += BASE58_ALPHABET[b58[i]];
  return out;
}

export function base58btcDecode(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < input.length && input[zeros] === '1') zeros += 1;

  const size = Math.ceil(((input.length - zeros) * 733) / 1000) + 1;
  const bytes = new Uint8Array(size);
  let length = 0;

  for (let i = zeros; i < input.length; i += 1) {
    const value = BASE58_MAP[input[i]];
    if (value === undefined) throw new Error(`invalid base58 character "${input[i]}"`);
    let carry = value;
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
      carry += 58 * bytes[k];
      bytes[k] = carry % 256;
      carry = (carry / 256) | 0;
    }
    length = j;
  }

  const out = new Uint8Array(zeros + length);
  out.set(bytes.subarray(size - length), zeros);
  return out;
}

/** Multibase base58btc: the `z` prefix used by Multikey and Data Integrity proofs. */
export function multibaseEncode58(bytes: Uint8Array): string {
  return `z${base58btcEncode(bytes)}`;
}

export function multibaseDecode58(value: string): Uint8Array {
  if (!value.startsWith('z')) {
    throw new Error(`expected a base58btc multibase value starting with "z", got "${value.slice(0, 8)}…"`);
  }
  return base58btcDecode(value.slice(1));
}

/** Multibase base64url-no-pad: the `u` prefix used by Bitstring Status Lists. */
export function multibaseEncode64url(bytes: Uint8Array): string {
  return `u${Buffer.from(bytes).toString('base64url')}`;
}

export function multibaseDecode64url(value: string): Uint8Array {
  if (!value.startsWith('u')) {
    throw new Error(`expected a base64url multibase value starting with "u", got "${value.slice(0, 8)}…"`);
  }
  return new Uint8Array(Buffer.from(value.slice(1), 'base64url'));
}

/** Multicodec varint prefixes for the key types we support. */
export const MULTICODEC = {
  ed25519Pub: Uint8Array.from([0xed, 0x01]),
  ed25519Priv: Uint8Array.from([0x80, 0x26]),
} as const;

export function withPrefix(prefix: Uint8Array, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

export function stripPrefix(prefix: Uint8Array, value: Uint8Array): Uint8Array {
  for (let i = 0; i < prefix.length; i += 1) {
    if (value[i] !== prefix[i]) throw new Error('unexpected multicodec prefix');
  }
  return value.subarray(prefix.length);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
