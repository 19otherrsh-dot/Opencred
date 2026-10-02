import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  buildDidDocument,
  buildStatusEntry,
  buildStatusListCredential,
  createBitstring,
  decodePublicKeyMultibase,
  didWebFromUrl,
  encodePrivateKeyMultibase,
  decodePrivateKeyMultibase,
  generateEd25519KeyPair,
  setBit,
  signDocument,
  STATUS_LIST_SIZE,
  type DidDocument,
  type StatusListEntry,
} from '@opencred/credentials';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { loadConfig } from '../../config';

/** P2002 is Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Map a sequential counter to a scattered status-list index.
 *
 * The W3C Bitstring Status List spec asks issuers not to assign indices
 * sequentially, because the list is deliberately public: sequential slots would
 * publish an issuer's issuance volume and ordering to anyone who fetches it, and
 * would let an observer correlate two credentials as neighbours.
 *
 * The obvious fix — pick at random and retry on collision — reintroduces the
 * race this function exists to avoid. So instead the counter is permuted by a
 * format-preserving permutation: a four-round Feistel network over 2^18 with
 * cycle-walking down into the 2^17 domain. A permutation is injective by
 * construction, so distinct counters always yield distinct indices, and the
 * per-list salt means two organisations do not share an ordering.
 */
function scatterIndex(counter: number, salt: string): number {
  const HALF_BITS = 9; // 2 x 9 = 18 bits = 262,144
  const HALF_MASK = (1 << HALF_BITS) - 1;
  const DOMAIN = 1 << (HALF_BITS * 2);

  const round = (value: number, roundNumber: number): number =>
    createHash('sha256')
      .update(`${salt}:${roundNumber}:${value}`, 'utf8')
      .digest()
      .readUInt16BE(0) & HALF_MASK;

  let value = counter % DOMAIN;

  // Cycle-walk: a permutation over 2^18 lands outside our 2^17 range about half
  // the time, so re-apply until it lands inside. Two iterations on average.
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

  // Unreachable in practice; fall back to the identity rather than throw, since
  // a credential with an unscattered index is far better than an unissued one.
  return counter % STATUS_LIST_SIZE;
}

/**
 * Issuer cryptographic identity: keys, DID documents and revocation lists.
 *
 * Every organisation gets its own Ed25519 key at creation time. Not a shared
 * platform key — that is the difference between "OpenCred says this credential
 * is real" and "Example University says this credential is real", and only the
 * second survives the university leaving OpenCred. The public key is published
 * in the org's DID document; the private key is encrypted at rest and never
 * leaves the API process.
 */
@Injectable()
export class IssuerService {
  private readonly logger = new Logger(IssuerService.name);
  private readonly publicUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {
    this.publicUrl = loadConfig().PUBLIC_URL.replace(/\/+$/, '');
  }

  /** The org's public origin: its verified custom domain, else the platform's. */
  originFor(org: { branding: unknown }): string {
    const branding = (org.branding ?? {}) as {
      customDomain?: string | null;
      customDomainVerifiedAt?: string | null;
    };
    if (branding.customDomain && branding.customDomainVerifiedAt) {
      return `https://${branding.customDomain}`;
    }
    return this.publicUrl;
  }

  /**
   * The DID an organisation issues under.
   *
   * Path-scoped (`did:web:host:o:acme`) rather than host-scoped, because on
   * multi-tenant Cloud many organisations share one hostname and a host-scoped
   * DID would make them indistinguishable. An org on its own verified domain
   * gets the cleaner host-scoped form.
   */
  didFor(org: { slug: string; branding: unknown }): string {
    const branding = (org.branding ?? {}) as {
      customDomain?: string | null;
      customDomainVerifiedAt?: string | null;
    };
    if (branding.customDomain && branding.customDomainVerifiedAt) {
      return didWebFromUrl(`https://${branding.customDomain}`);
    }
    return didWebFromUrl(this.publicUrl, `o/${org.slug}`);
  }

  async ensureKey(organizationId: string): Promise<{
    keyId: string;
    publicKeyMultibase: string;
    privateKeyBytes: Uint8Array;
  }> {
    const existing = await this.prisma.issuerKey.findFirst({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return {
        keyId: existing.keyId,
        publicKeyMultibase: existing.publicKeyMultibase,
        privateKeyBytes: decodePrivateKeyMultibase(
          this.crypto.decrypt(existing.privateKeyEncrypted),
        ),
      };
    }

    return this.createKey(organizationId);
  }

  async createKey(organizationId: string): Promise<{
    keyId: string;
    publicKeyMultibase: string;
    privateKeyBytes: Uint8Array;
  }> {
    const pair = generateEd25519KeyPair();
    const existingCount = await this.prisma.issuerKey.count({ where: { organizationId } });
    const keyId = `key-${existingCount + 1}`;

    await this.prisma.issuerKey.create({
      data: {
        organizationId,
        keyId,
        algorithm: 'Ed25519',
        publicKeyMultibase: pair.publicKeyMultibase,
        privateKeyEncrypted: this.crypto.encrypt(
          encodePrivateKeyMultibase(pair.privateKeyBytes),
        ),
        status: 'active',
      },
    });

    this.logger.log(`created issuer key ${keyId} for organisation ${organizationId}`);
    return { keyId, publicKeyMultibase: pair.publicKeyMultibase, privateKeyBytes: pair.privateKeyBytes };
  }

  /**
   * Rotate to a fresh signing key.
   *
   * The previous key is marked `rotated`, not deleted, and stays in the DID
   * document. Credentials signed with it must keep verifying — a key rotation
   * that invalidates a decade of issued diplomas is not a rotation, it is an
   * outage.
   */
  async rotateKey(organizationId: string): Promise<{ keyId: string }> {
    await this.prisma.issuerKey.updateMany({
      where: { organizationId, status: 'active' },
      data: { status: 'rotated', rotatedAt: new Date() },
    });
    const created = await this.createKey(organizationId);
    return { keyId: created.keyId };
  }

  async didDocument(organizationSlug: string): Promise<DidDocument> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: organizationSlug },
      include: {
        issuerKeys: {
          where: { status: { in: ['active', 'rotated'] } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!org) throw new NotFoundException(`no organisation with slug "${organizationSlug}"`);
    if (org.issuerKeys.length === 0) {
      throw new NotFoundException(`organisation "${organizationSlug}" has no published keys`);
    }

    const did = this.didFor(org);
    const origin = this.originFor(org);
    const base = buildDidDocument({
      did,
      publicKeyMultibase: org.issuerKeys[0].publicKeyMultibase,
      keyId: org.issuerKeys[0].keyId,
      serviceEndpoint: `${origin}/v1/public`,
      alsoKnownAs: org.website ? [org.website] : undefined,
    });

    // Rotated keys stay resolvable so historic credentials keep verifying.
    for (const key of org.issuerKeys.slice(1)) {
      const vmId = `${did}#${key.keyId}`;
      base.verificationMethod.push({
        id: vmId,
        type: 'Multikey',
        controller: did,
        publicKeyMultibase: key.publicKeyMultibase,
      });
      if (key.status === 'active') base.assertionMethod.push(vmId);
    }

    return base;
  }

  publicKeyBytesFromMultibase(multibase: string): Uint8Array {
    return decodePublicKeyMultibase(multibase);
  }

  // -------------------------------------------------------------------------
  // Revocation (W3C Bitstring Status List)
  // -------------------------------------------------------------------------

  statusListUrl(org: { slug: string; branding: unknown }, listIndex: number): string {
    return `${this.originFor(org)}/v1/public/status/${org.slug}/${listIndex}`;
  }

  /**
   * Reserve a status-list slot for a credential about to be issued.
   *
   * Indices are assigned at random within the list rather than sequentially:
   * a sequential index would publish an issuer's issuance volume and ordering
   * to anyone who fetches the (deliberately public) status list.
   */
  async allocateStatusEntry(
    organizationId: string,
    org: { slug: string; branding: unknown },
  ): Promise<{ statusListId: string; index: number; entry: StatusListEntry }> {
    const list = await this.currentStatusList(organizationId);

    // An atomic increment is the allocation. Postgres serialises the update, so
    // every concurrent worker gets a distinct counter — a read-then-probe scheme
    // would let two workers pick the same slot, and revoking one credential
    // would then revoke a stranger's.
    const updated = await this.prisma.statusList.update({
      where: { id: list.id },
      data: { assignedCount: { increment: 1 } },
      select: { assignedCount: true },
    });

    const index = scatterIndex(updated.assignedCount - 1, list.id);

    return {
      statusListId: list.id,
      index,
      entry: buildStatusEntry({
        statusListCredentialUrl: this.statusListUrl(org, list.listIndex),
        index,
      }),
    };
  }

  /**
   * Rebuild the status entry for a credential that already holds a slot.
   *
   * Used when re-signing after a post-issuance edit: the credential must keep
   * the same slot on the same list, or a previously published revocation would
   * silently stop applying to it.
   */
  async statusEntryFor(
    org: { slug: string; branding: unknown },
    statusListId: string,
    index: number,
  ): Promise<StatusListEntry> {
    const list = await this.prisma.statusList.findUnique({ where: { id: statusListId } });
    if (!list) throw new NotFoundException(`status list ${statusListId} not found`);
    return buildStatusEntry({
      statusListCredentialUrl: this.statusListUrl(org, list.listIndex),
      index,
    });
  }

  /**
   * The status list new credentials are allocated from, creating one if needed.
   *
   * This runs on every issuance, concurrently across every worker. The first
   * credentials for a brand-new organisation therefore *all* find no list and
   * all try to create list 1 at once — so the create is expected to lose a race
   * and the unique constraint is the arbitration, not an error. Losing simply
   * means somebody else made the list we were about to make.
   *
   * `upsert` is not usable here: the natural key includes `listIndex`, which is
   * what we are computing, so an upsert would still race on the read.
   */
  private async currentStatusList(organizationId: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.prisma.statusList.findFirst({
        where: { organizationId, purpose: 'revocation' },
        orderBy: { listIndex: 'desc' },
      });

      // Roll to a new list well before the bitstring fills, so allocation never
      // degenerates into a long linear probe.
      if (existing && existing.assignedCount < STATUS_LIST_SIZE * 0.8) return existing;

      const listIndex = (existing?.listIndex ?? 0) + 1;

      try {
        return await this.prisma.statusList.create({
          data: {
            organizationId,
            purpose: 'revocation',
            listIndex,
            bits: Buffer.from(createBitstring()),
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;

        // Another worker created this list first. Read it back and use it.
        const winner = await this.prisma.statusList.findUnique({
          where: {
            organizationId_purpose_listIndex: {
              organizationId,
              purpose: 'revocation',
              listIndex,
            },
          },
        });
        if (winner) return winner;
        // The winner disappeared between the conflict and the read; loop.
      }
    }

    throw new Error(
      `could not obtain a revocation status list for organisation ${organizationId} after 5 attempts`,
    );
  }

  async setRevoked(statusListId: string, index: number, revoked: boolean): Promise<void> {
    const list = await this.prisma.statusList.findUnique({ where: { id: statusListId } });
    if (!list) return;
    const bits = new Uint8Array(list.bits);
    setBit(bits, index, revoked);
    await this.prisma.statusList.update({
      where: { id: statusListId },
      data: { bits: Buffer.from(bits) },
    });
  }

  /** Bulk revocation in one write, for `POST /batches/:id/revoke`. */
  async setRevokedMany(
    entries: Array<{ statusListId: string; index: number }>,
    revoked: boolean,
  ): Promise<void> {
    const byList = new Map<string, number[]>();
    for (const entry of entries) {
      const list = byList.get(entry.statusListId) ?? [];
      list.push(entry.index);
      byList.set(entry.statusListId, list);
    }

    for (const [statusListId, indices] of byList) {
      const list = await this.prisma.statusList.findUnique({ where: { id: statusListId } });
      if (!list) continue;
      const bits = new Uint8Array(list.bits);
      for (const index of indices) setBit(bits, index, revoked);
      await this.prisma.statusList.update({
        where: { id: statusListId },
        data: { bits: Buffer.from(bits) },
      });
    }
  }

  /**
   * The signed status list credential served at the public URL.
   *
   * It is itself a Verifiable Credential, signed by the same issuer key, so a
   * third-party verifier can confirm that a revocation list actually came from
   * the issuer rather than from whoever controls the hosting.
   */
  async statusListCredential(organizationSlug: string, listIndex: number): Promise<unknown> {
    const org = await this.prisma.organization.findUnique({ where: { slug: organizationSlug } });
    if (!org) throw new NotFoundException(`no organisation with slug "${organizationSlug}"`);

    const list = await this.prisma.statusList.findFirst({
      where: { organizationId: org.id, purpose: 'revocation', listIndex },
    });
    if (!list) throw new NotFoundException(`status list ${listIndex} not found`);

    const did = this.didFor(org);
    const credential = buildStatusListCredential({
      id: this.statusListUrl(org, listIndex),
      issuer: did,
      purpose: 'revocation',
      bits: new Uint8Array(list.bits),
      validFrom: list.updatedAt.toISOString(),
      // Verifier caches may hold this for five minutes; revocation is not
      // instant for third parties and pretending otherwise would be dishonest.
      ttlMs: 300_000,
    });

    const key = await this.ensureKey(org.id);
    return signDocument(credential as unknown as Record<string, unknown>, {
      privateKeyBytes: key.privateKeyBytes,
      verificationMethod: `${did}#${key.keyId}`,
    });
  }
}
