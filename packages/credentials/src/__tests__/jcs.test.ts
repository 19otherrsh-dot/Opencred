import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../jcs';

test('JCS sorts object keys by UTF-16 code unit', () => {
  assert.equal(canonicalize({ b: 1, a: 2, C: 3 }), '{"C":3,"a":2,"b":1}');
});

test('JCS sorts nested keys and preserves array order', () => {
  assert.equal(
    canonicalize({ z: [{ b: 1, a: 2 }, 3], a: 'x' }),
    '{"a":"x","z":[{"a":2,"b":1},3]}',
  );
});

test('JCS uses ES6 number serialisation', () => {
  assert.equal(canonicalize({ n: 1e21 }), '{"n":1e+21}');
  assert.equal(canonicalize({ n: 1.0 }), '{"n":1}');
  assert.equal(canonicalize({ n: -0 }), '{"n":0}');
  assert.equal(canonicalize({ n: 333333333.33333329 }), '{"n":333333333.3333333}');
});

test('JCS rejects non-finite numbers', () => {
  assert.throws(() => canonicalize({ n: NaN }), /NaN or Infinity/);
  assert.throws(() => canonicalize({ n: Infinity }), /NaN or Infinity/);
});

test('JCS escapes strings per RFC 8785', () => {
  // Reserved characters get the short escapes; control characters below 0x20
  // that have no short form are escaped as \u00xx.
  const newlineQuoteBackslash = String.fromCharCode(10, 34, 92);
  assert.equal(canonicalize({ s: newlineQuoteBackslash }), '{"s":"\\n\\"\\\\"}');
  assert.equal(canonicalize({ s: String.fromCharCode(11) }), '{"s":"\\u000b"}');
  // Non-ASCII is emitted literally, not escaped.
  assert.equal(canonicalize({ s: 'eé€' }), '{"s":"eé€"}');
});

test('JCS omits undefined members and nulls array holes', () => {
  assert.equal(canonicalize({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalize([1, undefined, 3]), '[1,null,3]');
});

test('JCS output is order-independent for equivalent objects', () => {
  const a = { id: 'x', proof: { b: 2, a: 1 }, list: [3, 1, 2] };
  const b = { list: [3, 1, 2], proof: { a: 1, b: 2 }, id: 'x' };
  assert.equal(canonicalize(a), canonicalize(b));
});
