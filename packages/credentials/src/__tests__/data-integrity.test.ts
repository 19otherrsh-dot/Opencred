import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEd25519KeyPair, didKeyFromPublicKey } from '../keys';
import { signDocument, verifyDocument, credentialHash, CRYPTOSUITE } from '../data-integrity';
import { buildAchievementCredential, validateAchievementCredential } from '../openbadges';
import { buildStatusEntry } from '../status-list';

function sampleCredential(overrides: Record<string, unknown> = {}) {
  return buildAchievementCredential({
    credentialId: 'urn:uuid:6f5c1f7e-0f45-4a2a-9b7f-2c7d8a1c9e01',
    verificationUrl: 'https://certs.example.edu/v/abc123',
    issuer: {
      id: 'did:web:certs.example.edu',
      name: 'Example University',
      url: 'https://example.edu',
    },
    recipient: { name: 'Priya Raman', email: 'Priya@Example.com' },
    achievement: {
      name: 'Advanced Data Engineering',
      description: 'Completed the 12-week advanced data engineering programme.',
      achievementType: 'Certificate',
      skills: ['ETL', 'Data modelling'],
    },
    issuedAt: '2026-03-01T00:00:00.000Z',
    status: buildStatusEntry({
      statusListCredentialUrl: 'https://certs.example.edu/status/1',
      index: 4711,
    }),
    ...overrides,
  });
}

test('a freshly built credential passes structural validation', () => {
  assert.deepEqual(validateAchievementCredential(sampleCredential()), []);
});

test('structural validation catches a missing achievement name', () => {
  const bad = sampleCredential() as Record<string, any>;
  delete bad.credentialSubject.achievement.name;
  assert.ok(validateAchievementCredential(bad).includes('achievement.name is required'));
});

test('sign then verify round-trips with a resolved-free local key', async () => {
  const keys = generateEd25519KeyPair();
  const signed = signDocument(sampleCredential(), {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: 'did:web:certs.example.edu#key-1',
  });

  assert.equal(signed.proof.type, 'DataIntegrityProof');
  assert.equal(signed.proof.cryptosuite, CRYPTOSUITE);
  assert.equal(signed.proof.proofPurpose, 'assertionMethod');
  assert.ok(signed.proof.proofValue.startsWith('z'));

  const result = await verifyDocument(signed, { publicKeyBytes: keys.publicKeyBytes });
  assert.equal(result.verified, true, result.errors.join('; '));
  assert.equal(result.controller, 'did:web:certs.example.edu');
});

test('tampering with any field invalidates the signature (FR-VER-02)', async () => {
  const keys = generateEd25519KeyPair();
  const signed = signDocument(sampleCredential(), {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: 'did:web:certs.example.edu#key-1',
  }) as Record<string, any>;

  const mutations: Array<[string, () => void]> = [
    ['recipient achievement name', () => { signed.credentialSubject.achievement.name = 'Nobel Prize'; }],
    ['issuer name', () => { signed.issuer.name = 'Harvard'; }],
    ['validFrom', () => { signed.validFrom = '2020-01-01T00:00:00.000Z'; }],
    ['credential id', () => { signed.id = 'urn:uuid:00000000-0000-4000-8000-000000000000'; }],
    ['status list index', () => { signed.credentialStatus.statusListIndex = '1'; }],
    ['added field', () => { signed.honours = 'summa cum laude'; }],
  ];

  for (const [label, mutate] of mutations) {
    const original = JSON.parse(JSON.stringify(signed));
    mutate();
    const result = await verifyDocument(signed, { publicKeyBytes: keys.publicKeyBytes });
    assert.equal(result.verified, false, `mutation "${label}" was not detected`);
    for (const key of Object.keys(signed)) delete signed[key];
    Object.assign(signed, original);
  }

  // ...and the untouched document still verifies afterwards.
  const restored = await verifyDocument(signed as any, { publicKeyBytes: keys.publicKeyBytes });
  assert.equal(restored.verified, true);
});

test('key order in the JSON does not affect verification', async () => {
  const keys = generateEd25519KeyPair();
  const signed = signDocument(sampleCredential(), {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: 'did:web:certs.example.edu#key-1',
  });

  // Round-tripping through a store that reorders keys is normal; canonicalisation
  // is precisely what makes that safe.
  const reordered = Object.fromEntries(
    Object.entries(signed as Record<string, unknown>).reverse(),
  ) as any;

  const result = await verifyDocument(reordered, { publicKeyBytes: keys.publicKeyBytes });
  assert.equal(result.verified, true, result.errors.join('; '));
});

test('a proof made by a different key does not verify', async () => {
  const issuer = generateEd25519KeyPair();
  const attacker = generateEd25519KeyPair();
  const signed = signDocument(sampleCredential(), {
    privateKeyBytes: attacker.privateKeyBytes,
    verificationMethod: 'did:web:certs.example.edu#key-1',
  });
  const result = await verifyDocument(signed, { publicKeyBytes: issuer.publicKeyBytes });
  assert.equal(result.verified, false);
});

test('a proof cannot be replayed under a different proof purpose', async () => {
  const keys = generateEd25519KeyPair();
  const signed = signDocument(sampleCredential(), {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: 'did:web:certs.example.edu#key-1',
    proofPurpose: 'authentication',
  }) as Record<string, any>;

  // Relabelling the purpose must fail, because the purpose is inside the
  // hashed proof configuration.
  signed.proof.proofPurpose = 'assertionMethod';
  const result = await verifyDocument(signed as any, { publicKeyBytes: keys.publicKeyBytes });
  assert.equal(result.verified, false);
});

test('an unsigned credential reports the absence of a proof', async () => {
  const result = await verifyDocument(sampleCredential() as any, {});
  assert.equal(result.verified, false);
  assert.deepEqual(result.errors, ['credential carries no proof']);
});

test('credentialHash ignores the proof and is stable across key reordering', () => {
  const keys = generateEd25519KeyPair();
  const credential = sampleCredential();
  const signed = signDocument(credential, {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: 'did:web:certs.example.edu#key-1',
  });
  assert.equal(credentialHash(credential as any), credentialHash(signed as any));
  assert.match(credentialHash(credential as any), /^sha256-[0-9a-f]{64}$/);
});

test('did:key derives from and resolves back to the same public key', async () => {
  const keys = generateEd25519KeyPair();
  const did = didKeyFromPublicKey(keys.publicKeyBytes);
  assert.ok(did.startsWith('did:key:z6Mk'), `unexpected did:key prefix: ${did}`);

  const signed = signDocument({ '@context': ['https://www.w3.org/ns/credentials/v2'], id: 'urn:x' }, {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: `${did}#${did.slice('did:key:'.length)}`,
  });
  const result = await verifyDocument(signed);
  assert.equal(result.verified, true, result.errors.join('; '));
});
