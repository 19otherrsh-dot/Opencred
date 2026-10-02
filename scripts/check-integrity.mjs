#!/usr/bin/env node
/**
 * Data integrity audit.
 *
 * Checks the invariants that a credentialing platform must hold and that no
 * type system can enforce. Intended to run on a schedule in production and
 * before any migration that adds a constraint.
 *
 *   node scripts/check-integrity.mjs [--fix-orphans]
 *
 * Every check here exists because violating it would be *silently* wrong —
 * nothing errors, nobody notices, and a credential quietly means the wrong
 * thing. That is the failure mode worth paying for a nightly job to catch.
 */

import './load-env.mjs';
import { PrismaClient } from '@prisma/client';
import { verifyDocument, decodePublicKeyMultibase } from '../packages/credentials/dist/index.js';

const prisma = new PrismaClient();
const findings = [];

const log = (message) => process.stdout.write(`${message}\n`);
const ok = (message) => log(`  \x1b[32mok\x1b[0m    ${message}`);
const bad = (message) => {
  findings.push(message);
  log(`  \x1b[31mFAIL\x1b[0m  ${message}`);
};
const warn = (message) => log(`  \x1b[33mwarn\x1b[0m  ${message}`);

async function main() {
  log('OpenCred data integrity audit\n');

  // --- 1. Status-list slot uniqueness ---------------------------------------
  // Two credentials sharing a slot means revoking one revokes the other, and
  // the affected holder is never told.
  log('Status list slots');
  const duplicateSlots = await prisma.$queryRawUnsafe(
    `SELECT "statusListId", "statusListIndex", COUNT(*)::int AS n
       FROM credentials
      WHERE "statusListId" IS NOT NULL AND "statusListIndex" IS NOT NULL
      GROUP BY 1, 2
     HAVING COUNT(*) > 1
      LIMIT 50`,
  );

  if (duplicateSlots.length === 0) {
    ok('no two credentials share a revocation slot');
  } else {
    bad(`${duplicateSlots.length} status-list slots are shared by more than one credential`);
    for (const row of duplicateSlots.slice(0, 5)) {
      log(`        list ${row.statusListId} index ${row.statusListIndex} — ${row.n} credentials`);
    }
  }

  // --- 2. Issued credentials must be signed ---------------------------------
  log('\nSignatures');
  const unsigned = await prisma.credential.count({
    where: { status: { in: ['issued', 'expired'] }, credentialJson: { equals: null } },
  });
  if (unsigned === 0) ok('every issued credential carries a signed document');
  else bad(`${unsigned} issued credentials have no signed document`);

  const noHash = await prisma.credential.count({
    where: { status: { in: ['issued', 'expired'] }, credentialHash: null },
  });
  if (noHash === 0) ok('every issued credential records its content hash');
  else bad(`${noHash} issued credentials have no content hash`);

  // --- 3. Spot-check that signatures actually verify -------------------------
  const sample = await prisma.credential.findMany({
    where: { status: 'issued', credentialJson: { not: undefined } },
    take: 25,
    orderBy: { issuedAt: 'desc' },
    include: {
      organization: {
        include: { issuerKeys: { where: { status: { in: ['active', 'rotated'] } } } },
      },
    },
  });

  let verified = 0;
  let failed = 0;

  for (const credential of sample) {
    if (!credential.credentialJson) continue;

    // Try every published key: a credential signed before a rotation still
    // verifies against the key it was signed with.
    let matched = false;
    for (const key of credential.organization.issuerKeys) {
      const result = await verifyDocument(credential.credentialJson, {
        publicKeyBytes: decodePublicKeyMultibase(key.publicKeyMultibase),
      });
      if (result.verified) {
        matched = true;
        break;
      }
    }

    if (matched) verified += 1;
    else {
      failed += 1;
      bad(`credential ${credential.publicId} does not verify against any published issuer key`);
    }
  }

  if (sample.length === 0) warn('no issued credentials to spot-check');
  else if (failed === 0) ok(`${verified} of ${verified} sampled credentials verify`);

  // --- 4. Revocation is reflected in the status list ------------------------
  log('\nRevocation consistency');
  const revoked = await prisma.credential.findMany({
    where: { status: 'revoked', statusListId: { not: null } },
    select: { publicId: true, statusListId: true, statusListIndex: true },
    take: 500,
  });

  const listCache = new Map();
  let inconsistent = 0;

  for (const credential of revoked) {
    if (!listCache.has(credential.statusListId)) {
      listCache.set(
        credential.statusListId,
        await prisma.statusList.findUnique({ where: { id: credential.statusListId } }),
      );
    }
    const list = listCache.get(credential.statusListId);
    if (!list) continue;

    const bits = new Uint8Array(list.bits);
    const index = credential.statusListIndex;
    const isSet = (bits[index >> 3] & (0x80 >> (index & 7))) !== 0;

    if (!isSet) {
      inconsistent += 1;
      bad(
        `credential ${credential.publicId} is revoked in the database but its status-list bit is clear — ` +
          'third-party verifiers would still see it as valid',
      );
    }
  }

  if (revoked.length === 0) ok('no revoked credentials to check');
  else if (inconsistent === 0) ok(`all ${revoked.length} revocations are published in the status list`);

  // --- 5. Orphaned artefacts -------------------------------------------------
  log('\nReferential integrity');
  const orphanedEvents = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM credential_events e
      WHERE NOT EXISTS (SELECT 1 FROM credentials c WHERE c.id = e."credentialId")`,
  );
  if (orphanedEvents[0].n === 0) ok('no events reference a missing credential');
  else bad(`${orphanedEvents[0].n} events reference a credential that no longer exists`);

  const orgsWithoutKeys = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM organizations o
      WHERE NOT EXISTS (SELECT 1 FROM issuer_keys k WHERE k."organizationId" = o.id)`,
  );
  if (orgsWithoutKeys[0].n === 0) ok('every organisation has a signing key');
  else warn(`${orgsWithoutKeys[0].n} organisations have no signing key and cannot issue yet`);

  // --- 6. Erasure completeness -----------------------------------------------
  log('\nData erasure');
  const erasedWithData = await prisma.credential.count({
    where: { recipient: { erasedAt: { not: null } }, credentialJson: { not: undefined } },
  });
  if (erasedWithData === 0) ok('no erased recipient still has a signed credential document');
  else
    bad(
      `${erasedWithData} credentials belong to an erased recipient but still hold a signed document ` +
        'containing their name',
    );

  // --- Result ----------------------------------------------------------------
  log(`\n${'─'.repeat(60)}`);
  if (findings.length === 0) {
    log('\x1b[32mAll invariants hold.\x1b[0m');
  } else {
    log(`\x1b[31m${findings.length} problems found.\x1b[0m`);
  }
  log('─'.repeat(60));

  await prisma.$disconnect();
  process.exit(findings.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  process.stderr.write(`integrity audit failed: ${err?.stack ?? err}\n`);
  await prisma.$disconnect();
  process.exit(2);
});
