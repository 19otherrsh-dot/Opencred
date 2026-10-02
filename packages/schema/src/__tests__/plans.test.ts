import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, PLAN_IDS, SELF_SERVE_PLANS, planFor } from '../plans';

/**
 * Section 12 pricing commitments, as tests.
 *
 * These are marketing promises made in code, which is the only place a promise
 * cannot quietly stop being true. If someone ever adds a plan with a setup fee,
 * this suite fails before the pricing page ships.
 */

test('no plan charges a setup fee (FR-BIL-03)', () => {
  for (const id of PLAN_IDS) {
    assert.equal(PLANS[id].setupFeeCents, 0, `${id} has a setup fee`);
  }
});

test('no plan requires an annual contract', () => {
  for (const id of PLAN_IDS) {
    assert.equal(PLANS[id].annualContractRequired, false, `${id} requires an annual contract`);
  }
});

test('Enterprise publishes a starting price rather than hiding behind sales', () => {
  const enterprise = PLANS.enterprise;
  assert.equal(enterprise.priceCents, null, 'Enterprise is negotiated, so it has no fixed price');
  assert.equal(
    typeof enterprise.startingAtCents,
    'number',
    'Enterprise must publish a starting price — the whole positioning depends on it',
  );
  assert.ok(enterprise.startingAtCents! > 0);
});

test('the self-hosted Community Edition is free and unlimited', () => {
  const community = PLANS.community;
  assert.equal(community.priceCents, 0);
  assert.equal(community.includedCredentialsPerYear, null, 'community must be unlimited');
  assert.equal(community.selfHosted, true);
});

test('Community Edition is not feature-crippled against Cloud', () => {
  // The pitch is that nothing is withheld from the free self-hosted edition to
  // make Cloud look better. The only differences should be things that only
  // make sense as a hosted service.
  const community = PLANS.community.features;
  const scale = PLANS.scale.features;

  for (const feature of ['customDomain', 'whiteLabelEmail', 'fullWhiteLabel', 'webhooks', 'automation'] as const) {
    assert.equal(community[feature], true, `community is missing ${feature}`);
    assert.equal(community[feature], scale[feature], `community differs from Scale on ${feature}`);
  }

  assert.equal(community.analytics, 'full');
  assert.equal(community.auditLog, true);
  assert.equal(community.seats, null, 'self-hosting must not cap team size');
});

test('paid plans meter overage instead of hard-stopping issuance', () => {
  // A graduating cohort must not stop mid-batch because a counter rolled over.
  for (const id of ['growth', 'scale'] as const) {
    assert.equal(
      typeof PLANS[id].overageCentsPerCredential,
      'number',
      `${id} has no overage rate, so it would have to block issuance`,
    );
  }

  // The free tier is the one place a hard limit is honest, and it is published.
  assert.equal(PLANS.free.overageCentsPerCredential, null);
  assert.equal(PLANS.free.includedCredentialsPerYear, 500);
});

test('paid plans are ordered by price and by included volume', () => {
  const ladder = ['free', 'growth', 'scale'] as const;
  for (let i = 1; i < ladder.length; i += 1) {
    assert.ok(
      PLANS[ladder[i]].priceCents! > PLANS[ladder[i - 1]].priceCents!,
      `${ladder[i]} is not more expensive than ${ladder[i - 1]}`,
    );
    assert.ok(
      PLANS[ladder[i]].includedCredentialsPerYear! > PLANS[ladder[i - 1]].includedCredentialsPerYear!,
      `${ladder[i]} does not include more credentials than ${ladder[i - 1]}`,
    );
  }
});

test('overage gets cheaper as the plan gets bigger', () => {
  assert.ok(
    PLANS.scale.overageCentsPerCredential! < PLANS.growth.overageCentsPerCredential!,
    'a larger plan should not have a worse marginal rate',
  );
});

test('self-serve plans are exactly the fixed-price Cloud tiers', () => {
  assert.deepEqual([...SELF_SERVE_PLANS], ['free', 'growth', 'scale']);
  for (const id of SELF_SERVE_PLANS) {
    assert.equal(typeof PLANS[id].priceCents, 'number', `${id} is self-serve but has no fixed price`);
  }
});

test('rate limits rise monotonically with the plan', () => {
  const ladder = ['free', 'growth', 'scale', 'enterprise'] as const;
  for (let i = 1; i < ladder.length; i += 1) {
    assert.ok(
      PLANS[ladder[i]].features.apiRateLimitPerMinute >=
        PLANS[ladder[i - 1]].features.apiRateLimitPerMinute,
      `${ladder[i]} has a lower rate limit than ${ladder[i - 1]}`,
    );
  }
});

test('planFor falls back to the free tier for unknown input', () => {
  assert.equal(planFor('growth').id, 'growth');
  assert.equal(planFor('nonsense').id, 'free');
  assert.equal(planFor(null).id, 'free');
  assert.equal(planFor(undefined).id, 'free');
});
