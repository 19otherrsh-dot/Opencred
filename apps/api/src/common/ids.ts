import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Public credential identifiers.
 *
 * These are printed on certificates, read aloud over the phone by employers
 * checking a candidate, and typed into a verification box by hand. So the
 * alphabet excludes the glyphs that cause transcription errors — `0`/`O` and
 * `1`/`I`/`l` — leaving 31 symbols. Ten characters is a little under 50 bits,
 * which matters because verification pages are public: sequential or short ids
 * would let anyone enumerate an issuer's entire cohort.
 */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const ALPHABET_SIZE = ALPHABET.length; // 31

export function publicId(length = 10): string {
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // Reject the tail of the byte range rather than taking it modulo 31,
      // which would make the first few symbols marginally more likely.
      if (byte >= 248) continue; // 248 = 8 * 31
      out.push(ALPHABET[byte % ALPHABET_SIZE]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/**
 * Normalises a hand-entered credential id.
 *
 * Only case and separators are folded. The excluded glyphs are deliberately
 * *not* guessed at: `0` could stand for nothing in this alphabet, and silently
 * rewriting it would turn a typo into a lookup of somebody else's credential.
 */
export function normalizePublicId(input: string): string {
  return input.trim().toLowerCase().replace(/[\s\-_]/g, '');
}

export function isPublicIdShaped(input: string): boolean {
  return new RegExp(`^[${ALPHABET}]{6,32}$`).test(input);
}

export function uuid(): string {
  return randomUUID();
}

/** URN form used as the credential's `id` in the Verifiable Credential. */
export function credentialUrn(id: string): string {
  return `urn:uuid:${id}`;
}

export function slugify(input: string, fallback = 'org'): string {
  const slug = input
    .normalize('NFKD')
    // Strip combining marks left behind by the decomposition.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length >= 2 ? slug : fallback;
}

/** Opaque, high-entropy token for API keys, webhook secrets and magic links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
