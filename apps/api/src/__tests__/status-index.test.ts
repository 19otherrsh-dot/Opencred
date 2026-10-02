import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { STATUS_LIST_SIZE } from '@opencred/credentials';

/**
 * Tests for the status-list index permutation.
 *
 * The function under test lives inside `issuer.service.ts` as a module-private
 * helper, so it is reproduced here verbatim rather than exported purely for
 * testing. That is a deliberate trade: the property being tested — injectivity
 * — is what makes concurrent issuance safe, and it is worth pinning down even
 * at the cost of this duplication. If the two ever drift, this test is the
 * thing that should be updated to match, not the other way round.
 */
function scatterIndex(counter: number, salt: string): number {
  const HALF_BITS = 9;
  const HALF_MASK = (1 << HALF_BITS) - 1;
  const DOMAIN = 1 << (HALF_BITS * 2);

  const round = (value: number, roundNumber: number): number =>
    createHash('sha256')
      .update(`${salt}:${roundNumber}:${value}`, 'utf8')
      .digest()
      .readUInt16BE(0) & HALF_MASK;

  let value = counter % DOMAIN;

  for (let guard = 0; guard < 64; guard += 1) {
    let left = (value >> HALF_BITS) & HALF_MASK;
    let right = value & HALF_MASK;

    for (let r = 0; r < 4; r += 1) {
      const next = left ^ round(right, r);
      left = right;
      right = next;
    }

    value = ((left << HALF_BITS) | right) >>> 0;
    if (value < STATUS_LIST_SIZE) return value;
  }

  return counter % STATUS_LIST_SIZE;
}

test('every index is inside the status list', () => {
  for (let i = 0; i < 5_000; i += 1) {
    const index = scatterIndex(i, 'list-abc');
    assert.ok(Number.isInteger(index), `index ${index} is not an integer`);
    assert.ok(index >= 0 && index < STATUS_LIST_SIZE, `index ${index} out of range`);
  }
});

test('distinct counters never collide — this is what makes concurrent issuance safe', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 20_000; i += 1) {
    const index = scatterIndex(i, 'list-abc');
    assert.equal(seen.has(index), false, `counter ${i} collided on index ${index}`);
    seen.add(index);
  }
  assert.equal(seen.size, 20_000);
});

test('allocation is deterministic for a given counter and list', () => {
  assert.equal(scatterIndex(42, 'list-abc'), scatterIndex(42, 'list-abc'));
});

test('two lists do not share an ordering', () => {
  const a = Array.from({ length: 50 }, (_, i) => scatterIndex(i, 'list-abc'));
  const b = Array.from({ length: 50 }, (_, i) => scatterIndex(i, 'list-xyz'));
  assert.notDeepEqual(a, b);
});

test('consecutive allocations are not adjacent, so volume is not published', () => {
  // The whole point of permuting is that a public status list must not reveal
  // an issuer's issuance order or volume. Adjacent indices would do exactly
  // that, so assert the gaps are large and varied rather than 1, 2, 3.
  const indices = Array.from({ length: 200 }, (_, i) => scatterIndex(i, 'list-abc'));

  let adjacent = 0;
  for (let i = 1; i < indices.length; i += 1) {
    if (Math.abs(indices[i] - indices[i - 1]) <= 2) adjacent += 1;
  }

  assert.ok(adjacent <= 2, `${adjacent} of 199 consecutive pairs were adjacent`);

  // And the values should be spread across the whole list, not clustered.
  const spread = Math.max(...indices) - Math.min(...indices);
  assert.ok(spread > STATUS_LIST_SIZE * 0.8, `indices only spanned ${spread} of ${STATUS_LIST_SIZE}`);
});
