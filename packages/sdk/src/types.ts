/**
 * Wire types for the OpenCred API.
 *
 * Hand-written rather than generated from the OpenAPI document, deliberately.
 * A generated client mirrors the server's internal shapes, including the ones
 * that are incidental; these types are the *contract* a connector author should
 * be able to read. There is a test that fails if the API grows an endpoint this
 * file does not know about.
 */

export type CredentialStatus = 'draft' | 'issued' | 'expired' | 'revoked';
export type CredentialKind = 'certificate' | 'badge';

export interface Recipient {
  name: string;
  email: string;
  externalId?: string;
}

export interface Achievement {
  name?: string;
  description?: string;
  criteriaNarrative?: string;
  criteriaUrl?: string;
  achievementType?: string;
  skills?: string[];
  image?: string;
}

export interface IssueRequest {
  templateId: string;
  recipient: Recipient;
  title?: string;
  description?: string;
  /** Values for the template's declared merge fields. */
  data?: Record<string, string | number | null>;
  issuedAt?: string;
  expiresAt?: string | null;
  achievement?: Achievement;
  tags?: string[];
  suppressEmail?: boolean;
  scheduledAt?: string | null;
  /**
   * Send this from anything that can retry. Without it a redelivered event
   * issues a second credential to the same person, and the first anyone hears
   * about it is the recipient.
   */
  idempotencyKey?: string;
}

export interface IssueResult {
  id: string;
  publicId: string;
  status: CredentialStatus;
  /** True when an existing credential was returned for a repeated idempotency key. */
  deduplicated: boolean;
}

export interface CredentialSummary {
  id: string;
  publicId: string;
  title: string;
  kind: CredentialKind;
  status: CredentialStatus;
  recipient: { id: string; name: string; email: string; externalId: string | null };
  template: { id: string; name: string };
  batchId: string | null;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  emailStatus: string;
  verificationUrl: string;
  thumbnailUrl: string | null;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  kind: CredentialKind;
  version: number;
  archivedAt: string | null;
  credentialCount: number;
  updatedAt: string;
}

export interface VerificationChecks {
  exists: boolean;
  signatureValid: boolean;
  notRevoked: boolean;
  notExpired: boolean;
  issuerTrusted: boolean;
  /** `null` means "not checked", deliberately distinct from "checked and absent". */
  anchored: boolean | null;
}

export interface VerificationResult {
  credentialId: string;
  publicId: string;
  status: CredentialStatus;
  valid: boolean;
  kind: CredentialKind;
  checks: VerificationChecks;
  issuer: { name: string; url: string | null; did: string | null; verified: boolean };
  recipient: { name: string; email: string | null };
  credential: {
    title: string;
    description: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    revocationReason: string | null;
  };
  errors: string[];
  verifiedAt: string;
  badgeUrl: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
}

export interface BulkVerificationRow {
  publicId: string;
  found: boolean;
  valid: boolean;
  status: string;
  title?: string;
  issuer?: string;
  issuedAt?: string;
}

export type WebhookEventType =
  | 'credential.issued'
  | 'credential.updated'
  | 'credential.revoked'
  | 'credential.expired'
  | 'credential.verified'
  | 'credential.viewed'
  | 'credential.downloaded'
  | 'batch.completed'
  | 'batch.failed'
  | 'recipient.created';

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  organizationId: string;
  test?: boolean;
  data: T;
}

export interface CredentialIssuedEvent {
  credentialId: string;
  publicId: string;
  title: string;
  status: string;
  verificationUrl: string;
  recipient: { name: string; email: string };
  issuedAt: string;
  expiresAt: string | null;
  batchId: string | null;
}
