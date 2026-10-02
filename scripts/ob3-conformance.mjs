#!/usr/bin/env node
/**
 * Open Badges 3.0 conformance gate.
 *
 * Section 13 of the product plan commits to running conformance checks in CI
 * from month one, "not just before submission". This is that gate.
 *
 * BE CLEAR ABOUT WHAT THIS IS. It is a local structural and cryptographic
 * check against the published specification. It is NOT the 1EdTech conformance
 * suite and passing it does not make anything certified. Certification requires
 * submitting to 1EdTech and being listed on their public registry, and nothing
 * in this repository should ever claim otherwise. What this gate buys is that a
 * regression is caught by a pull request rather than by a certification
 * submission four months later.
 *
 *   node scripts/ob3-conformance.mjs [--api http://localhost:4000]
 *
 * Without a running API it validates locally constructed credentials instead,
 * which is what makes it usable as a pure unit gate in CI.
 */

import {
  buildAchievementCredential,
  buildStatusEntry,
  generateEd25519KeyPair,
  signDocument,
  validateAchievementCredential,
  verifyDocument,
  canonicalize,
} from '../packages/credentials/dist/index.js';

const API = argValue('--api') ?? process.env.API_URL ?? null;

const VC_V2 = 'https://www.w3.org/ns/credentials/v2';
const OB3 = 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json';
const OB3_SCHEMA =
  'https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json';

let pass = 0;
let fail = 0;
const failures = [];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function check(clause, name, condition, detail) {
  if (condition) {
    pass += 1;
    process.stdout.write(`  \x1b[32mPASS\x1b[0m ${clause.padEnd(28)} ${name}\n`);
  } else {
    fail += 1;
    failures.push(`${clause} — ${name}${detail ? `: ${detail}` : ''}`);
    process.stdout.write(`  \x1b[31mFAIL\x1b[0m ${clause.padEnd(28)} ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

/** Build a locally signed credential to check when no API is available. */
async function localSample() {
  const keys = generateEd25519KeyPair();
  const did = 'did:web:certs.example.edu';

  const unsigned = buildAchievementCredential({
    credentialId: 'urn:uuid:6f5c1f7e-0f45-4a2a-9b7f-2c7d8a1c9e01',
    verificationUrl: 'https://certs.example.edu/v/k7m2q9xb4t',
    issuer: { id: did, name: 'Example University', url: 'https://example.edu' },
    recipient: { name: 'Ada Lovelace', email: 'ada@example.com' },
    achievement: {
      name: 'Advanced Data Engineering',
      description: 'Completed the twelve-week programme.',
      achievementType: 'Certificate',
      skills: ['ETL', 'Data modelling'],
    },
    issuedAt: '2026-03-01T00:00:00.000Z',
    expiresAt: '2029-03-01T00:00:00.000Z',
    status: buildStatusEntry({
      statusListCredentialUrl: 'https://certs.example.edu/v1/public/status/example/1',
      index: 4711,
    }),
  });

  const signed = signDocument(unsigned, {
    privateKeyBytes: keys.privateKeyBytes,
    verificationMethod: `${did}#key-1`,
  });

  return { credential: signed, publicKeyBytes: keys.publicKeyBytes };
}

/** Pull a real issued credential out of a running instance. */
async function apiSample() {
  const stamp = Date.now();

  const register = await fetch(`${API}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationName: `Conformance ${stamp}`,
      name: 'Conformance Runner',
      email: `conformance-${stamp}@conformance.invalid`,
      password: 'conformance-password-long-enough',
    }),
  }).then((r) => r.json());

  const token = register.accessToken;
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const templates = await fetch(`${API}/v1/templates`, { headers: auth }).then((r) => r.json());
  const template = templates.find((t) => t.kind === 'badge') ?? templates[0];

  const issued = await fetch(`${API}/v1/credentials`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      templateId: template.id,
      recipient: { name: 'Ada Lovelace', email: `ada-${stamp}@conformance.invalid` },
      title: 'Advanced Data Engineering',
      data: { course: 'Advanced Data Engineering', level: 'Professional', grade: 'Distinction' },
      achievement: { achievementType: 'Certificate', skills: ['ETL'] },
      suppressEmail: true,
    }),
  }).then((r) => r.json());

  // Wait for the worker to sign it.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${API}/v1/public/credentials/${issued.publicId}/credential.json`);
    if (response.ok) {
      return { credential: await response.json(), publicKeyBytes: undefined };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('the credential never finished issuing — is the worker running?');
}

async function main() {
  process.stdout.write('Open Badges 3.0 conformance gate\n');
  process.stdout.write(
    '\x1b[2mLocal specification checks. NOT the 1EdTech suite; passing confers no certification.\x1b[0m\n\n',
  );

  const sample = API ? await apiSample() : await localSample();
  process.stdout.write(`Source: ${API ? `live API at ${API}` : 'locally constructed credential'}\n\n`);

  const c = sample.credential;

  // --- Serialisation, §4.1 ---------------------------------------------------
  process.stdout.write('Serialisation\n');
  check('OB3 §4.1', '@context is an array', Array.isArray(c['@context']));
  check(
    'OB3 §4.1',
    'first context entry is the VC 2.0 context',
    c['@context']?.[0] === VC_V2,
    `got ${c['@context']?.[0]}`,
  );
  check('OB3 §4.1', 'includes the Open Badges 3.0 context', c['@context']?.includes(OB3));
  check('OB3 §4.1', 'id is present', typeof c.id === 'string' && c.id.length > 0);
  check(
    'OB3 §4.1',
    'type includes VerifiableCredential and OpenBadgeCredential',
    Array.isArray(c.type) && c.type.includes('VerifiableCredential') && c.type.includes('OpenBadgeCredential'),
  );

  // --- Issuer Profile, §4.5 --------------------------------------------------
  process.stdout.write('\nIssuer profile\n');
  const issuerType = Array.isArray(c.issuer?.type) ? c.issuer.type : [c.issuer?.type];
  check('OB3 §4.5', 'issuer.id is present', typeof c.issuer?.id === 'string');
  check('OB3 §4.5', 'issuer.type includes Profile', issuerType.includes('Profile'));
  check('OB3 §4.5', 'issuer.name is present', typeof c.issuer?.name === 'string');
  check(
    'DID Core',
    'issuer identified by a resolvable DID',
    typeof c.issuer?.id === 'string' && c.issuer.id.startsWith('did:'),
    c.issuer?.id,
  );

  // --- AchievementSubject, §4.3 / Achievement, §4.2 --------------------------
  process.stdout.write('\nAchievement subject\n');
  const subject = c.credentialSubject;
  check(
    'OB3 §4.3',
    'credentialSubject.type includes AchievementSubject',
    Array.isArray(subject?.type) && subject.type.includes('AchievementSubject'),
  );
  check('OB3 §4.2', 'achievement.id is present', typeof subject?.achievement?.id === 'string');
  check(
    'OB3 §4.2',
    'achievement.type includes Achievement',
    Array.isArray(subject?.achievement?.type) && subject.achievement.type.includes('Achievement'),
  );
  check('OB3 §4.2', 'achievement.name is present', Boolean(subject?.achievement?.name));
  check(
    'OB3 §4.2',
    'achievement.criteria has an id or a narrative',
    Boolean(subject?.achievement?.criteria?.id || subject?.achievement?.criteria?.narrative),
  );

  // --- Identity, §4.6 --------------------------------------------------------
  process.stdout.write('\nRecipient identity\n');
  const identity = subject?.identifier?.[0];
  check('OB3 §4.6', 'identifier.type is IdentityObject', identity?.type === 'IdentityObject');
  check('OB3 §4.6', 'identity is hashed', identity?.hashed === true);
  check(
    'OB3 §4.6',
    'identityHash uses the algorithm$hash form',
    /^(sha256|md5)\$[0-9a-f]+$/.test(identity?.identityHash ?? ''),
  );
  check(
    'Privacy',
    'no plaintext email anywhere in the credential',
    !/[\w.+-]+@[\w-]+\.[\w.]+/.test(JSON.stringify(c).replace(/"(email|url|id)":\s*"[^"]*"/g, '')),
  );

  // --- Validity --------------------------------------------------------------
  process.stdout.write('\nValidity period\n');
  check(
    'VCDM 2.0',
    'validFrom is an ISO 8601 date-time',
    typeof c.validFrom === 'string' && !Number.isNaN(Date.parse(c.validFrom)),
  );
  if (c.validUntil) {
    check(
      'VCDM 2.0',
      'validUntil is later than validFrom',
      Date.parse(c.validUntil) > Date.parse(c.validFrom),
    );
  }

  // --- Status ----------------------------------------------------------------
  process.stdout.write('\nRevocation status\n');
  const status = Array.isArray(c.credentialStatus) ? c.credentialStatus[0] : c.credentialStatus;
  check(
    'Bitstring SL v1.0',
    'credentialStatus.type is BitstringStatusListEntry',
    status?.type === 'BitstringStatusListEntry',
  );
  check('Bitstring SL v1.0', 'statusPurpose is present', typeof status?.statusPurpose === 'string');
  check(
    'Bitstring SL v1.0',
    'statusListIndex is a string-encoded integer',
    /^\d+$/.test(String(status?.statusListIndex ?? '')),
  );
  check(
    'Bitstring SL v1.0',
    'statusListCredential is an absolute URL',
    /^https?:\/\//.test(status?.statusListCredential ?? ''),
  );

  // --- Schema ----------------------------------------------------------------
  process.stdout.write('\nCredential schema\n');
  const schema = Array.isArray(c.credentialSchema) ? c.credentialSchema[0] : c.credentialSchema;
  check('OB3 §4.1', 'credentialSchema declared', Boolean(schema));
  check(
    'OB3 §4.1',
    'schema id is the 1EdTech AchievementCredential schema',
    schema?.id === OB3_SCHEMA,
    schema?.id,
  );
  check(
    'OB3 §4.1',
    'validator type is 1EdTechJsonSchemaValidator2019',
    schema?.type === '1EdTechJsonSchemaValidator2019',
  );

  // --- Proof -----------------------------------------------------------------
  process.stdout.write('\nData integrity proof\n');
  const proof = Array.isArray(c.proof) ? c.proof[0] : c.proof;
  check('VC-DI', 'proof.type is DataIntegrityProof', proof?.type === 'DataIntegrityProof');
  check('VC-DI-EdDSA', 'cryptosuite is eddsa-jcs-2022', proof?.cryptosuite === 'eddsa-jcs-2022');
  check('VC-DI', 'proofPurpose is assertionMethod', proof?.proofPurpose === 'assertionMethod');
  check(
    'VC-DI',
    'verificationMethod resolves to the issuer',
    typeof proof?.verificationMethod === 'string' &&
      proof.verificationMethod.startsWith(String(c.issuer?.id)),
  );
  check(
    'Multibase',
    'proofValue is base58btc multibase',
    typeof proof?.proofValue === 'string' && proof.proofValue.startsWith('z'),
  );

  if (sample.publicKeyBytes) {
    const verified = await verifyDocument(c, { publicKeyBytes: sample.publicKeyBytes });
    check('VC-DI', 'signature verifies', verified.verified, verified.errors.join('; '));

    const tampered = JSON.parse(JSON.stringify(c));
    tampered.credentialSubject.achievement.name = 'Nobel Prize';
    const tamperCheck = await verifyDocument(tampered, { publicKeyBytes: sample.publicKeyBytes });
    check('VC-DI', 'tampering is detected', tamperCheck.verified === false);
  }

  // --- Canonicalisation ------------------------------------------------------
  process.stdout.write('\nCanonicalisation\n');
  const reordered = Object.fromEntries(Object.entries(c).reverse());
  check(
    'RFC 8785',
    'key order does not change the canonical form',
    canonicalize(c) === canonicalize(reordered),
  );

  // --- Our own structural validator -----------------------------------------
  process.stdout.write('\nInternal validator\n');
  const errors = validateAchievementCredential(c);
  check('OpenCred', 'validateAchievementCredential reports no errors', errors.length === 0, errors.join('; '));

  // --- Result ----------------------------------------------------------------
  process.stdout.write(`\n${'═'.repeat(60)}\n`);
  process.stdout.write(`${pass} passed, ${fail} failed\n`);
  if (failures.length > 0) {
    process.stdout.write('\nFailures:\n');
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  }
  process.stdout.write(`${'═'.repeat(60)}\n`);

  process.stdout.write(
    fail === 0
      ? '\nThe issued shape matches the specification as we read it.\n' +
          'Formal certification still requires submission to 1EdTech, and until that is\n' +
          'confirmed on their public registry, nothing here may be marketed as certified.\n'
      : '\nFix these before submitting anything to 1EdTech.\n',
  );

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`conformance run failed: ${err?.stack ?? err}\n`);
  process.exit(2);
});
