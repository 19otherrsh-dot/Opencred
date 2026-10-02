import { z } from 'zod';
import { credentialKindSchema } from './template';

/**
 * FR-ISS-06 — credential lifecycle states.
 *
 * `draft` covers a batch that has been prepared and validated but not
 * confirmed; `issued` is the live state; `expired` is derived from
 * `expiresAt` at read time *and* materialised by a scheduled sweep so that
 * verification stays correct even if the sweep is late; `revoked` is terminal
 * and immediately visible on the public verification page.
 */
export const CREDENTIAL_STATUSES = ['draft', 'issued', 'expired', 'revoked'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];
export const credentialStatusSchema = z.enum(CREDENTIAL_STATUSES);

export const BATCH_STATUSES = [
  'draft',
  'validating',
  'ready',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/**
 * FR-ANA-01 — the recipient-level event vocabulary. Every one of these is
 * exportable (FR-ANA-03); none of them is UI-only.
 */
export const CREDENTIAL_EVENTS = [
  'created',
  'rendered',
  'email_queued',
  'email_sent',
  'email_failed',
  'email_bounced',
  'email_opened',
  'downloaded',
  'viewed',
  'verified',
  'shared',
  'linkedin_added',
  'wallet_added',
  'edited',
  'revoked',
  'expired',
  'reissued',
] as const;
export type CredentialEventType = (typeof CREDENTIAL_EVENTS)[number];

export const issueRequestSchema = z.object({
  templateId: z.string().min(1),
  recipient: z.object({
    name: z.string().min(1).max(300),
    email: z.string().email().max(320),
    externalId: z.string().max(200).optional(),
  }),
  /** Falls back to the template's own title when omitted. */
  title: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  /** Values for the template's declared merge fields. */
  data: z.record(z.union([z.string(), z.number(), z.null()])).default({}),
  issuedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  /** Open Badges achievement metadata; required for `kind: badge`. */
  achievement: z
    .object({
      name: z.string().max(300).optional(),
      description: z.string().max(2000).optional(),
      criteriaNarrative: z.string().max(2000).optional(),
      criteriaUrl: z.string().url().max(2000).optional(),
      /** 1EdTech achievement types, e.g. Certificate, Badge, Course, License. */
      achievementType: z.string().max(80).optional(),
      skills: z.array(z.string().max(120)).max(50).optional(),
      image: z.string().max(2000).optional(),
    })
    .optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  /** Skip the delivery email — useful when the caller sends its own. */
  suppressEmail: z.boolean().default(false),
  /** FR-ISS-03: queue for a future moment instead of issuing now. */
  scheduledAt: z.string().datetime().nullable().optional(),
  /**
   * Caller-supplied idempotency key. Event-driven issuance (FR-ISS-04) retries;
   * without this an LMS webhook redelivery silently double-issues.
   */
  idempotencyKey: z.string().max(200).optional(),
});
export type IssueRequest = z.infer<typeof issueRequestSchema>;

export const credentialPatchSchema = z
  .object({
    /** FR-ISS-05 — post-issuance correction of a single credential. */
    recipientName: z.string().min(1).max(300).optional(),
    recipientEmail: z.string().email().max(320).optional(),
    title: z.string().max(300).optional(),
    description: z.string().max(2000).optional(),
    data: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    templateId: z.string().optional(),
    /** Re-send the delivery email after the correction. */
    notify: z.boolean().default(false),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type CredentialPatch = z.infer<typeof credentialPatchSchema>;

export const verificationResultSchema = z.object({
  credentialId: z.string(),
  publicId: z.string(),
  status: credentialStatusSchema,
  valid: z.boolean(),
  kind: credentialKindSchema,
  checks: z.object({
    exists: z.boolean(),
    signatureValid: z.boolean(),
    notRevoked: z.boolean(),
    notExpired: z.boolean(),
    issuerTrusted: z.boolean(),
    /** Phase 2, opt-in (Section 9.3). `null` when anchoring is not enabled. */
    anchored: z.boolean().nullable(),
  }),
  issuer: z.object({
    name: z.string(),
    url: z.string().nullable(),
    did: z.string().nullable(),
    verified: z.boolean(),
  }),
  recipient: z.object({ name: z.string(), email: z.string().nullable() }),
  credential: z.object({
    title: z.string(),
    description: z.string().nullable(),
    issuedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    revocationReason: z.string().nullable(),
  }),
  errors: z.array(z.string()).default([]),
  verifiedAt: z.string(),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const WEBHOOK_EVENTS = [
  'credential.issued',
  'credential.updated',
  'credential.revoked',
  'credential.expired',
  'credential.verified',
  'credential.viewed',
  'credential.downloaded',
  'batch.completed',
  'batch.failed',
  'recipient.created',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
