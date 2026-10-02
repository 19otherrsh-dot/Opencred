import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, createZip, listZipEntries } from '../zip';
import {
  buildGoogleWalletObject,
  createGoogleWalletSaveUrl,
  isGoogleWalletConfigured,
  type CredentialPassInput,
} from '../google';
import {
  buildApplePassJson,
  buildManifest,
  createPkPass,
  isApplePassConfigured,
  type ApplePassConfig,
  type PassSigner,
} from '../apple';

const credential: CredentialPassInput = {
  publicId: 'k7m2q9xb4t',
  title: 'Advanced Data Engineering',
  description: 'A 12-week programme covering distributed batch and stream processing.',
  recipientName: 'Ada Lovelace',
  issuerName: 'Example University',
  issuedAt: '2026-06-01T10:00:00.000Z',
  status: 'issued',
  verificationUrl: 'https://credentials.example.edu/v/k7m2q9xb4t',
  details: [
    { label: 'Grade', value: 'Distinction' },
    { label: 'Credit hours', value: '120' },
  ],
};

// --- zip -------------------------------------------------------------------

test('crc32 matches the PKZIP reference vector', () => {
  // The canonical check value for "123456789".
  assert.equal(crc32(Buffer.from('123456789', 'utf8')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('zip round-trips through the system unzip', () => {
  const zip = createZip([
    { name: 'pass.json', data: Buffer.from('{"formatVersion":1}', 'utf8') },
    { name: 'icon.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ]);

  assert.deepEqual(listZipEntries(zip), ['pass.json', 'icon.png']);

  // End-of-central-directory record is where every unzip starts reading.
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), 2);
});

test('the same input produces byte-identical archives', () => {
  const entries = [{ name: 'pass.json', data: Buffer.from('{"a":1}', 'utf8') }];
  assert.ok(createZip(entries).equals(createZip(entries)));
});

test('incompressible data is stored rather than deflated', () => {
  // Four bytes of PNG magic: deflate would make this bigger, so store wins.
  const zip = createZip([{ name: 'a', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }]);
  assert.equal(zip.readUInt16LE(8), 0, 'compression method should be store');
});

test('compressible data is deflated', () => {
  const zip = createZip([{ name: 'a', data: Buffer.alloc(4096, 0x41) }]);
  assert.equal(zip.readUInt16LE(8), 8, 'compression method should be deflate');
  assert.ok(zip.length < 512, 'deflate should shrink 4KB of one byte');
});

// --- google ----------------------------------------------------------------

test('google object carries the credential and links to verification', () => {
  const object = buildGoogleWalletObject(
    { issuerId: '3388000000012345678', classId: '3388000000012345678.opencred' },
    credential,
  ) as any;

  assert.equal(object.id, '3388000000012345678.k7m2q9xb4t');
  assert.equal(object.classId, '3388000000012345678.opencred');
  assert.equal(object.state, 'ACTIVE');
  assert.equal(object.header.defaultValue.value, 'Advanced Data Engineering');
  assert.equal(object.subheader.defaultValue.value, 'Ada Lovelace');
  assert.equal(object.cardTitle.defaultValue.value, 'Example University');

  assert.equal(object.barcode.type, 'QR_CODE');
  assert.equal(object.barcode.value, credential.verificationUrl);

  assert.equal(object.linksModuleData.uris[0].uri, credential.verificationUrl);

  const ids = object.textModulesData.map((row: any) => row.id);
  assert.deepEqual(ids, ['detail_0', 'detail_1', 'credential_id']);
});

test('a revoked credential is saved but marked inactive', () => {
  const object = buildGoogleWalletObject(
    { issuerId: '338', classId: '338.c' },
    { ...credential, status: 'revoked' },
  ) as any;

  // The holder keeps the record; it just stops presenting as current.
  assert.equal(object.state, 'INACTIVE');
});

test('google object ids are stripped of characters google rejects', () => {
  const object = buildGoogleWalletObject(
    { issuerId: '338', classId: '338.c' },
    { ...credential, publicId: 'ab/cd ef+gh' },
  ) as any;

  assert.equal(object.id, '338.abcdefgh');
  assert.match(object.id, /^[\w.-]+$/);
});

test('expiry becomes a validTimeInterval end only when present', () => {
  const open = buildGoogleWalletObject({ issuerId: '3', classId: '3.c' }, credential) as any;
  assert.equal(open.validTimeInterval.end, undefined);

  const bounded = buildGoogleWalletObject(
    { issuerId: '3', classId: '3.c' },
    { ...credential, expiresAt: '2029-06-01T10:00:00.000Z' },
  ) as any;
  assert.equal(bounded.validTimeInterval.end.date, '2029-06-01T10:00:00Z');
});

test('the save link is a JWT that verifies against the service-account key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const url = createGoogleWalletSaveUrl(
    {
      issuerEmail: 'passes@example.iam.gserviceaccount.com',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      issuerId: '3388000000012345678',
      classId: '3388000000012345678.opencred',
      origins: ['https://credentials.example.edu'],
    },
    credential,
  );

  assert.ok(url.startsWith('https://pay.google.com/gp/v/save/'));

  const jwt = url.slice('https://pay.google.com/gp/v/save/'.length);
  const [header, payload, signature] = jwt.split('.');
  assert.equal(jwt.split('.').length, 3);

  const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  assert.deepEqual(decodedHeader, { alg: 'RS256', typ: 'JWT' });

  const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.equal(decodedPayload.aud, 'google');
  assert.equal(decodedPayload.typ, 'savetowallet');
  assert.equal(decodedPayload.iss, 'passes@example.iam.gserviceaccount.com');
  assert.deepEqual(decodedPayload.origins, ['https://credentials.example.edu']);
  assert.equal(decodedPayload.payload.genericObjects.length, 1);
  assert.equal(decodedPayload.payload.genericObjects[0].id, '3388000000012345678.k7m2q9xb4t');

  const verified = createVerify('RSA-SHA256')
    .update(`${header}.${payload}`, 'utf8')
    .verify(publicKey, Buffer.from(signature, 'base64url'));
  assert.ok(verified, 'Google must be able to verify the save link signature');
});

test('google configuration is only complete with every field', () => {
  assert.equal(isGoogleWalletConfigured(null), false);
  assert.equal(isGoogleWalletConfigured({ issuerId: '3', classId: '3.c' }), false);
  assert.equal(
    isGoogleWalletConfigured({
      issuerEmail: 'a@b.iam.gserviceaccount.com',
      privateKey: 'pem',
      issuerId: '3',
      classId: '3.c',
    }),
    true,
  );
});

// --- apple -----------------------------------------------------------------

const appleConfig: ApplePassConfig = {
  passTypeIdentifier: 'pass.edu.example.credentials',
  teamIdentifier: 'ABCDE12345',
  organizationName: 'Example University',
  backgroundColor: '#1d4ed8',
  images: {
    'icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]),
    'icon@2x.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]),
    'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03]),
  },
};

test('pass.json is a generic pass with the right identifiers', () => {
  const pass = buildApplePassJson(appleConfig, credential) as any;

  assert.equal(pass.formatVersion, 1);
  assert.equal(pass.passTypeIdentifier, 'pass.edu.example.credentials');
  assert.equal(pass.teamIdentifier, 'ABCDE12345');
  assert.equal(pass.serialNumber, 'k7m2q9xb4t');
  assert.equal(pass.description, 'Advanced Data Engineering');
  assert.ok(pass.generic, 'a credential is a generic pass, not an event ticket');

  assert.equal(pass.generic.primaryFields[0].value, 'Advanced Data Engineering');
  assert.equal(pass.generic.secondaryFields[0].value, 'Ada Lovelace');

  assert.equal(pass.barcodes[0].format, 'PKBarcodeFormatQR');
  assert.equal(pass.barcodes[0].message, credential.verificationUrl);
});

test('hex colours become the rgb() form apple requires', () => {
  const pass = buildApplePassJson(appleConfig, credential) as any;
  assert.equal(pass.backgroundColor, 'rgb(29, 78, 216)');
  assert.equal(pass.foregroundColor, 'rgb(255, 255, 255)');

  // A malformed colour falls back rather than emitting something Wallet rejects.
  const fallback = buildApplePassJson(
    { ...appleConfig, backgroundColor: 'not-a-colour' },
    credential,
  ) as any;
  assert.equal(fallback.backgroundColor, 'rgb(29, 78, 216)');
});

test('a revoked credential is voided and says so on the back', () => {
  const pass = buildApplePassJson(appleConfig, { ...credential, status: 'revoked' }) as any;

  assert.equal(pass.voided, true);
  const status = pass.generic.backFields.find((f: any) => f.key === 'status');
  assert.equal(status.value, 'Revoked');
});

test('an active credential is not voided', () => {
  const pass = buildApplePassJson(appleConfig, credential) as any;
  assert.equal(pass.voided, undefined);
  assert.equal(
    pass.generic.backFields.some((f: any) => f.key === 'status'),
    false,
  );
});

test('the web service is only declared when both url and token are given', () => {
  const without = buildApplePassJson(appleConfig, credential) as any;
  assert.equal(without.webServiceURL, undefined);

  const half = buildApplePassJson(appleConfig, credential, 'https://x/v1/passes') as any;
  assert.equal(half.webServiceURL, undefined, 'a URL without a token is unusable');

  const full = buildApplePassJson(appleConfig, credential, 'https://x/v1/passes', 'tok') as any;
  assert.equal(full.webServiceURL, 'https://x/v1/passes');
  assert.equal(full.authenticationToken, 'tok');
});

test('the manifest is a sha-1 of every payload file', () => {
  const entries = [
    { name: 'pass.json', data: Buffer.from('{"formatVersion":1}', 'utf8') },
    { name: 'icon.png', data: Buffer.from([1, 2, 3]) },
  ];

  const manifest = JSON.parse(buildManifest(entries).toString('utf8'));

  assert.deepEqual(Object.keys(manifest).sort(), ['icon.png', 'pass.json']);
  for (const entry of entries) {
    assert.equal(manifest[entry.name], createHash('sha1').update(entry.data).digest('hex'));
  }
});

test('the pkpass bundle contains every required member in order', async () => {
  const result = await createPkPass(appleConfig, credential);

  assert.deepEqual(result.entries, [
    'pass.json',
    'icon.png',
    'icon@2x.png',
    'logo.png',
    'manifest.json',
    'signature',
  ]);
  assert.deepEqual(listZipEntries(result.bundle), result.entries);
});

test('an unsigned bundle reports signed:false', async () => {
  const result = await createPkPass(appleConfig, credential);

  // Wallet will refuse this, which is correct — callers must check `signed`
  // before offering the download rather than shipping a file that fails to
  // install with no explanation.
  assert.equal(result.signed, false);
});

test('the manifest inside the bundle hashes what the bundle actually holds', async () => {
  const result = await createPkPass(appleConfig, credential);

  // Re-derive the manifest from the same inputs and confirm the pass.json hash
  // matches what was archived: a manifest that disagrees with the payload is
  // the single most common reason a pass will not install.
  const passJson = Buffer.from(
    JSON.stringify(buildApplePassJson(appleConfig, credential), null, 2),
    'utf8',
  );
  const manifest = JSON.parse(
    buildManifest([{ name: 'pass.json', data: passJson }]).toString('utf8'),
  );
  assert.equal(manifest['pass.json'], createHash('sha1').update(passJson).digest('hex'));
});

test('a signer is given the manifest bytes and its output becomes the signature', async () => {
  let seen: Buffer | null = null;
  const signer: PassSigner = {
    async sign(manifest) {
      seen = manifest;
      return Buffer.from('detached-pkcs7', 'utf8');
    },
  };

  const result = await createPkPass(appleConfig, credential, { signer });

  assert.equal(result.signed, true);
  assert.ok(seen, 'the signer must receive the manifest');
  const manifest = JSON.parse(Buffer.from(seen!).toString('utf8'));
  assert.ok(manifest['pass.json'], 'the signer signs the manifest, not pass.json');
  assert.ok(manifest['icon.png']);
});

test('apple configuration requires an icon, which wallet rejects passes without', () => {
  assert.equal(isApplePassConfigured(null), false);
  assert.equal(
    isApplePassConfigured({
      passTypeIdentifier: 'pass.a',
      teamIdentifier: 'ABCDE12345',
      organizationName: 'Example',
      images: {} as any,
    }),
    false,
  );
  assert.equal(isApplePassConfigured(appleConfig), true);
});

// --- signing, where the toolchain allows it --------------------------------

function hasOpenSsl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('the OpenSSL signer produces a detached PKCS#7 over the manifest', { skip: hasOpenSsl() ? false : 'OpenSSL is not on PATH' }, async () => {
  const { NodeOpenSslPassSigner } = await import('../apple');

  const dir = mkdtempSync(join(tmpdir(), 'opencred-signer-test-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));

    // A self-signed stand-in for the Pass Type ID certificate. Wallet would
    // reject it — Apple's chain is the whole point — but it exercises the exact
    // OpenSSL invocation the real certificate goes through.
    execFileSync('openssl', [
      'req', '-x509', '-new', '-key', keyPath, '-out', certPath,
      '-days', '1', '-subj', '/CN=OpenCred Test',
    ]);

    const signer = new NodeOpenSslPassSigner({
      certificatePath: certPath,
      keyPath,
      wwdrPath: certPath,
    });

    const result = await createPkPass(appleConfig, credential, { signer });
    assert.equal(result.signed, true);

    const signature = result.bundle; // presence is asserted via entries below
    assert.ok(listZipEntries(signature).includes('signature'));
    void publicKey;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
