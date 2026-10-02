import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_KEY_ROLES,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  roleAtLeast,
  roleHasPermission,
} from '../roles';

/**
 * FR-ID-02 acceptance criteria, as tests.
 *
 * The requirement names one specific behaviour — "an Issuer can create/send
 * credentials but cannot change billing or delete the org" — so that is
 * asserted literally rather than paraphrased into something weaker.
 */

test('an issuer can issue and revoke credentials', () => {
  assert.equal(roleHasPermission('issuer', 'credentials:issue'), true);
  assert.equal(roleHasPermission('issuer', 'credentials:revoke'), true);
});

test('an issuer cannot change billing or delete the organisation', () => {
  assert.equal(roleHasPermission('issuer', 'org:billing'), false);
  assert.equal(roleHasPermission('issuer', 'org:delete'), false);
});

test('a viewer can read but not write anything', () => {
  assert.equal(roleHasPermission('viewer', 'credentials:read'), true);
  assert.equal(roleHasPermission('viewer', 'analytics:read'), true);

  for (const permission of PERMISSIONS.filter((p) => !p.endsWith(':read'))) {
    assert.equal(
      roleHasPermission('viewer', permission),
      false,
      `viewer should not hold "${permission}"`,
    );
  }
});

test('an admin can manage everything except billing and deletion', () => {
  assert.equal(roleHasPermission('admin', 'members:manage'), true);
  assert.equal(roleHasPermission('admin', 'apikeys:manage'), true);
  assert.equal(roleHasPermission('admin', 'gdpr:manage'), true);
  assert.equal(roleHasPermission('admin', 'org:billing'), false);
  assert.equal(roleHasPermission('admin', 'org:delete'), false);
});

test('an owner holds every permission', () => {
  for (const permission of PERMISSIONS) {
    assert.equal(roleHasPermission('owner', permission), true, `owner is missing "${permission}"`);
  }
});

test('permissions are strictly cumulative up the role ladder', () => {
  // A higher role must never lack something a lower one has. Without this, a
  // promotion could silently take a capability away.
  for (let i = 1; i < ROLES.length; i += 1) {
    const lower = ROLES[i - 1];
    const higher = ROLES[i];
    for (const permission of ROLE_PERMISSIONS[lower]) {
      assert.equal(
        roleHasPermission(higher, permission),
        true,
        `${higher} should inherit "${permission}" from ${lower}`,
      );
    }
  }
});

test('roleAtLeast orders the ladder correctly', () => {
  assert.equal(roleAtLeast('owner', 'viewer'), true);
  assert.equal(roleAtLeast('admin', 'issuer'), true);
  assert.equal(roleAtLeast('issuer', 'issuer'), true);
  assert.equal(roleAtLeast('issuer', 'admin'), false);
  assert.equal(roleAtLeast('viewer', 'issuer'), false);
});

test('API keys can never be minted as owner', () => {
  // A long-lived machine credential that can change billing or delete the
  // workspace is a blast radius nobody needs.
  assert.equal(API_KEY_ROLES.includes('owner' as never), false);
  assert.deepEqual([...API_KEY_ROLES], ['viewer', 'issuer', 'admin']);
});

test('every declared permission is reachable by some role', () => {
  for (const permission of PERMISSIONS) {
    const holders = ROLES.filter((role) => roleHasPermission(role, permission));
    assert.ok(holders.length > 0, `nothing grants "${permission}"`);
  }
});
