/**
 * RFC 8785 — JSON Canonicalization Scheme.
 *
 * Why JCS and not JSON-LD/RDF canonicalization: the `eddsa-jcs-2022`
 * cryptosuite is a registered W3C Data Integrity suite that produces a stable
 * signature input without needing an RDF canonicalization pass, and therefore
 * without needing to dereference `@context` URLs at verification time.
 *
 * That last property matters more than it looks. A verifier that must fetch
 * JSON-LD contexts over the network to check a signature is a verifier that
 * fails when a context host has an outage — and it is a verifier a self-hosted,
 * air-gapped Community Edition install cannot run at all (FR-ID-04). JCS
 * verification is fully offline.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * RFC 8785 sorts object keys by their UTF-16 code units. JavaScript's default
 * string comparison is exactly that, so `sort()` with no comparator is correct
 * here — but it is worth stating, because it looks like an omission.
 */
function sortKeys(keys: string[]): string[] {
  return [...keys].sort();
}

function serialize(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error('cannot canonicalize NaN or Infinity (RFC 8785 §3.2.2.3)');
    }
    // ES6 Number::toString is exactly what RFC 8785 mandates, and it is what
    // JSON.stringify already emits — including the "-0 serialises as 0" rule.
    return JSON.stringify(n);
  }

  if (t === 'string') {
    // JSON.stringify implements the RFC 8785 string escaping rules verbatim.
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    // Array holes and `undefined` members serialise as null, matching JSON.
    return `[${value.map((v) => (v === undefined ? 'null' : serialize(v))).join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of sortKeys(Object.keys(obj))) {
      const v = obj[key];
      // Properties whose value is `undefined` are omitted, as in JSON.
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${serialize(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  throw new Error(`cannot canonicalize value of type ${t}`);
}

/** Canonical JSON string for `value`, per RFC 8785. */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

/** Canonical JSON as UTF-8 bytes — the actual signing input. */
export function canonicalizeToBytes(value: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(canonicalize(value), 'utf8'));
}

/** Structured clone that drops `undefined`, for building proof inputs safely. */
export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
