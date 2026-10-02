import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base58btcDecode,
  base58btcEncode,
  multibaseDecode64url,
  multibaseEncode64url,
} from '../encoding';

test('base58btc matches known Bitcoin test vectors', () => {
  assert.equal(base58btcEncode(Buffer.from('hello world', 'utf8')), 'StV1DL6CwTryKyV');
  assert.equal(base58btcEncode(Buffer.from([0x00, 0x00, 0x01])), '112');
  assert.equal(base58btcEncode(new Uint8Array(0)), '');
  assert.equal(base58btcEncode(Buffer.from([0x00])), '1');
  assert.equal(base58btcEncode(Buffer.from('61', 'hex')), '2g');
  assert.equal(base58btcEncode(Buffer.from('626262', 'hex')), 'a3gV');
  assert.equal(base58btcEncode(Buffer.from('516b6fcd0f', 'hex')), 'ABnLTmg');
});

test('base58btc round-trips arbitrary bytes including leading zeros', () => {
  for (const hex of ['', '00', '0000ff', 'ff', 'deadbeef', '00'.repeat(8) + 'abcdef']) {
    const bytes = Buffer.from(hex, 'hex');
    assert.deepEqual(Buffer.from(base58btcDecode(base58btcEncode(bytes))), bytes, `hex=${hex}`);
  }
});

test('base58btc rejects characters outside the alphabet', () => {
  assert.throws(() => base58btcDecode('0OIl'), /invalid base58 character/);
});

test('multibase base64url round-trips', () => {
  const bytes = new Uint8Array([0, 1, 250, 255, 128]);
  const encoded = multibaseEncode64url(bytes);
  assert.ok(encoded.startsWith('u'));
  assert.ok(!encoded.includes('='), 'base64url multibase must be unpadded');
  assert.deepEqual(multibaseDecode64url(encoded), bytes);
});
