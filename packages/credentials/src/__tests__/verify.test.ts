import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEd25519KeyPair } from '../keys';
import { buildDidDocument, didWebFromUrl, didWebToUrl } from '../did';
import { signDocument } from '../data-integrity';
import { buildAchievementCredential, hashedIdentity, identityMatches } from '../openbadges';
import {
  buildStatusEntry,
  buildStatusListCredential,
  createBitstring,
  setBit,
} from '../status-list';
import { verifyCredential } from '../verify';

const ISSUER_ORIGIN = 'https://certs.example.edu';
const ISSUER_DID = didWebFromUrl(ISSUER_ORIGIN);

test('did:web maps to and from its HTTPS location', () => {
  assert.equal(didWebFromUrl('https://certs.example.edu'), 'did:web:certs.example.edu');
  assert.equal(
    didWebToUrl('did:web:certs.example.edu'),
    'https://certs.example.edu/.well-known/did.json',
  );
  assert.equal(
    didWebFromUrl('https://example.edu/issuers/eng'),
    'did:web:example.edu:issuers:eng',
  );
  assert.equal(
    didWebToUrl('did:web:example.edu:issuers:eng'),
    'https://example.edu/issuers/eng/did.json',
  );
  // A non-default port is percent-encoded, per the did:web method.
  assert.equal(didWebFromUrl('http://localhost:3000'), 'did:web:localhost%3A3000');
  assert.equal(
    didWebToUrl('did:web:localhost%3A3000'),
    'https://localhost:3000/.well-known/did.json',
  );
});

function fixture() {
  const keys = generateEd25519KeyPair();
  const didDocument = buildDidDocument({
    did: ISSUER_DID,
    publicKeyMultibase: keys.publicKeyMultibase,
    serviceEndpoint: `${ISSUER_ORIGIN}/v1/public`,
  });
  const fetchDocument = async (url: string) => {
    assert.equal(url, `${ISSUER_ORIGIN}/.well-known/did.json`);
    return didDocument;
  };
  return { keys, didDocument, fetchDocument };
}

function credentialFor(issuedAt: string, expiresAt?: string, index = 4711) {
  return buildAchievementCredential({
    credentialId: 'urn:uuid:6f5c1f7e-0f45-4a2a-9b7f-2c7d8a1c9e01',
    verificationUrl: `${ISSUER_ORIGIN}/v/abc123`,
    issuer: { id: ISSUER_DID, name: 'Example University', url: 'https://example.edu' },
    recipient: { name: 'Priya Raman', email: 'priya@example.com' },
    achievement: { name: 'Advanced Data Engineering', achievementType: 'Certificate' },
    issuedAt,
    expiresAt,
    status: buildStatusEntry({ statusListCredentialUrl: `${ISSUER_ORIGIN}/status/1`, index }),
  });
}

test('a valid credential verifies end to end through did:web resolution', async () => {
  const { keys, fetchDocument } = fixture();
  const signed = signDocument(credentialFor('2026-03-01T00:00:00.000Z'), {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: `${ISSUER_DID}#key-1`,
  });

  const result = await verifyCredential(signed, {
    fetchDocument,
    fetchStatusList: async () =>
      buildStatusListCredential({
        id: `${ISSUER_ORIGIN}/status/1`,
        issuer: ISSUER_DID,
        purpose: 'revocation',
        bits: createBitstring(),
      }),
    now: new Date('2026-06-01T00:00:00.000Z'),
  });

  assert.equal(result.verified, true, result.errors.join('; '));
  assert.equal(result.checks.signature.issuerDid, ISSUER_DID);
  assert.equal(result.checks.status.checked, true);
  assert.equal(result.checks.status.revoked, false);
  assert.match(result.hash, /^sha256-[0-9a-f]{64}$/);
});

test('a revoked credential fails verification via the status list alone', async () => {
  const { keys, fetchDocument } = fixture();
  const signed = signDocument(credentialFor('2026-03-01T00:00:00.000Z', undefined, 9000), {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: `${ISSUER_DID}#key-1`,
  });

  const bits = createBitstring();
  setBit(bits, 9000, true);

  const result = await verifyCredential(signed, {
    fetchDocument,
    fetchStatusList: async () =>
      buildStatusListCredential({
        id: `${ISSUER_ORIGIN}/status/1`,
        issuer: ISSUER_DID,
        purpose: 'revocation',
        bits,
      }),
    now: new Date('2026-06-01T00:00:00.000Z'),
  });

  assert.equal(result.verified, false);
  assert.equal(result.checks.signature.ok, true, 'signature should still be intact');
  assert.equal(result.checks.status.revoked, true);
  assert.ok(result.errors.some((e) => e.includes('revoked')));
});

test('an expired credential is reported as expired, not as forged', async () => {
  const { keys, fetchDocument } = fixture();
  const signed = signDocument(
    credentialFor('2024-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
    { privateKeyBytes: keys.privateKeyBytes, verificationMethod: `${ISSUER_DID}#key-1` },
  );

  const result = await verifyCredential(signed, {
    fetchDocument,
    now: new Date('2026-06-01T00:00:00.000Z'),
  });

  assert.equal(result.verified, false);
  assert.equal(result.checks.signature.ok, true);
  assert.equal(result.checks.validity.expired, true);
});

test('a credential signed by one issuer but claiming another is rejected', async () => {
  const { keys, fetchDocument } = fixture();
  const credential = credentialFor('2026-03-01T00:00:00.000Z') as Record<string, any>;
  credential.issuer.id = 'did:web:harvard.edu';
  const signed = signDocument(credential as any, {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: `${ISSUER_DID}#key-1`,
  });

  const result = await verifyCredential(signed, { fetchDocument });
  assert.equal(result.verified, false);
  assert.ok(
    result.errors.some((e) => e.includes('claims issuer did:web:harvard.edu')),
    result.errors.join('; '),
  );
});

test('a DID document that does not contain the verification method fails closed', async () => {
  const { keys } = fixture();
  const other = generateEd25519KeyPair();
  const signed = signDocument(credentialFor('2026-03-01T00:00:00.000Z'), {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: `${ISSUER_DID}#key-9`,
  });

  const result = await verifyCredential(signed, {
    fetchDocument: async () =>
      buildDidDocument({ did: ISSUER_DID, publicKeyMultibase: other.publicKeyMultibase }),
  });
  assert.equal(result.verified, false);
  assert.ok(result.errors.some((e) => e.includes('not present in')));
});

test('requireStatusCheck turns an unreachable status list into a failure', async () => {
  const { keys, fetchDocument } = fixture();
  const signed = signDocument(credentialFor('2026-03-01T00:00:00.000Z'), {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: `${ISSUER_DID}#key-1`,
  });

  const lenient = await verifyCredential(signed, {
    fetchDocument,
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  assert.equal(lenient.verified, true, 'without the flag an unchecked status is not fatal');

  const strict = await verifyCredential(signed, {
    fetchDocument,
    requireStatusCheck: true,
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  assert.equal(strict.verified, false);
});

test('hashed recipient identity confirms a known address without revealing it', () => {
  const identity = hashedIdentity('Priya@Example.com');
  assert.equal(identity.hashed, true);
  assert.match(identity.identityHash, /^sha256\$[0-9a-f]{64}$/);
  // Case and surrounding whitespace are normalised before hashing.
  assert.equal(identityMatches(identity, '  priya@example.com '), true);
  assert.equal(identityMatches(identity, 'someone.else@example.com'), false);
  // A different salt for the same address yields a different hash, so badges
  // from two issuers cannot be correlated by the identity commitment.
  assert.notEqual(hashedIdentity('priya@example.com').identityHash, identity.identityHash);
});
