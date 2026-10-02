import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_LIST_SIZE,
  allocateIndex,
  buildStatusEntry,
  buildStatusListCredential,
  checkStatus,
  createBitstring,
  decodeBitstring,
  encodeBitstring,
  getBit,
  setBit,
} from '../status-list';

test('a fresh bitstring is the spec minimum size and all zeros', () => {
  const bits = createBitstring();
  assert.equal(bits.length, STATUS_LIST_SIZE / 8);
  assert.ok(bits.every((b) => b === 0));
});

test('bit 0 is the most significant bit of byte 0', () => {
  const bits = createBitstring();
  setBit(bits, 0, true);
  assert.equal(bits[0], 0b1000_0000);
  setBit(bits, 7, true);
  assert.equal(bits[0], 0b1000_0001);
  setBit(bits, 8, true);
  assert.equal(bits[1], 0b1000_0000);
});

test('bits set and clear independently', () => {
  const bits = createBitstring();
  for (const i of [0, 1, 63, 4711, STATUS_LIST_SIZE - 1]) setBit(bits, i, true);
  for (const i of [0, 1, 63, 4711, STATUS_LIST_SIZE - 1]) assert.equal(getBit(bits, i), true);
  assert.equal(getBit(bits, 2), false);
  setBit(bits, 63, false);
  assert.equal(getBit(bits, 63), false);
  assert.equal(getBit(bits, 4711), true);
});

test('out-of-range indices are rejected rather than silently wrapping', () => {
  const bits = createBitstring();
  assert.throws(() => setBit(bits, -1, true), RangeError);
  assert.throws(() => setBit(bits, STATUS_LIST_SIZE, true), RangeError);
  assert.throws(() => getBit(bits, 1.5), RangeError);
});

test('encoded list round-trips and compresses a sparse list hard', () => {
  const bits = createBitstring();
  setBit(bits, 4711, true);
  const encoded = encodeBitstring(bits);
  assert.ok(encoded.startsWith('u'));
  // 16 KiB of mostly-zero bits should compress to a couple of hundred bytes.
  assert.ok(encoded.length < 500, `encoded list unexpectedly large: ${encoded.length}`);
  const decoded = decodeBitstring(encoded);
  assert.equal(getBit(decoded, 4711), true);
  assert.equal(getBit(decoded, 4710), false);
});

test('checkStatus reads an entry out of a published list credential', () => {
  const bits = createBitstring();
  setBit(bits, 9000, true);
  const listCredential = buildStatusListCredential({
    id: 'https://certs.example.edu/status/1',
    issuer: 'did:web:certs.example.edu',
    purpose: 'revocation',
    bits,
  });

  assert.deepEqual(listCredential.type, ['VerifiableCredential', 'BitstringStatusListCredential']);
  assert.equal(listCredential.credentialSubject.id, 'https://certs.example.edu/status/1#list');

  const revoked = buildStatusEntry({
    statusListCredentialUrl: 'https://certs.example.edu/status/1',
    index: 9000,
  });
  const live = buildStatusEntry({
    statusListCredentialUrl: 'https://certs.example.edu/status/1',
    index: 9001,
  });

  assert.equal(checkStatus(listCredential, revoked).set, true);
  assert.equal(checkStatus(listCredential, live).set, false);
});

test('a purpose mismatch between entry and list is an error, not a false negative', () => {
  const listCredential = buildStatusListCredential({
    id: 'https://certs.example.edu/status/1',
    issuer: 'did:web:certs.example.edu',
    purpose: 'suspension',
    bits: createBitstring(),
  });
  const entry = buildStatusEntry({
    statusListCredentialUrl: 'https://certs.example.edu/status/1',
    index: 1,
    purpose: 'revocation',
  });
  assert.throws(() => checkStatus(listCredential, entry), /status purpose mismatch/);
});

test('index allocation avoids collisions', () => {
  const used = new Set<number>();
  for (let i = 0; i < 2000; i += 1) {
    const index = allocateIndex(used);
    assert.equal(used.has(index), false);
    used.add(index);
  }
  assert.equal(used.size, 2000);
});
