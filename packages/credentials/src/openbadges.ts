import { createHash, randomBytes } from 'node:crypto';
import type { StatusListEntry } from './status-list';

/**
 * FR-STD-01 / FR-STD-02 — Open Badges 3.0 and the W3C Verifiable Credentials
 * data model.
 *
 * One design decision worth stating up front: OpenCred issues *certificates*
 * as Open Badges 3.0 `AchievementCredential`s too, not only badges. An OB 3.0
 * AchievementCredential is itself a conformant W3C Verifiable Credential, and
 * `achievementType` already distinguishes a Certificate from a Badge, a Course
 * or a License. So a single, certified, interoperable data model covers the
 * whole product rather than badges getting the standards treatment and
 * certificates getting a bespoke JSON blob — which is roughly the state of the
 * category today.
 */

export const OB3_CONTEXT = 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json';
export const VC_V2_CONTEXT = 'https://www.w3.org/ns/credentials/v2';
export const OB3_ACHIEVEMENT_CREDENTIAL_SCHEMA =
  'https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json';

/** 1EdTech's controlled vocabulary for `achievement.achievementType`. */
export const ACHIEVEMENT_TYPES = [
  'Achievement',
  'ApprenticeshipCertificate',
  'Assessment',
  'Assignment',
  'AssociateDegree',
  'Award',
  'Badge',
  'BachelorDegree',
  'Certificate',
  'CertificateOfCompletion',
  'Certification',
  'CommunityService',
  'Competency',
  'Course',
  'CoCurricular',
  'Degree',
  'Diploma',
  'DoctoralDegree',
  'Fieldwork',
  'GeneralEducationDevelopment',
  'JourneymanCertificate',
  'LearningProgram',
  'License',
  'Membership',
  'ProfessionalDoctorate',
  'QualityAssuranceCredential',
  'MasterCertificate',
  'MasterDegree',
  'MicroCredential',
  'ResearchDoctorate',
  'SecondarySchoolDiploma',
] as const;
export type AchievementType = (typeof ACHIEVEMENT_TYPES)[number];

export interface OB3Image {
  id: string;
  type: 'Image';
  caption?: string;
}

export interface OB3Profile {
  id: string;
  type: string[] | string;
  name?: string;
  url?: string;
  email?: string;
  description?: string;
  image?: OB3Image;
  address?: Record<string, unknown>;
  official?: string;
}

export interface OB3Criteria {
  id?: string;
  narrative?: string;
}

export interface OB3Alignment {
  type: string[];
  targetName: string;
  targetUrl: string;
  targetDescription?: string;
  targetCode?: string;
  targetFramework?: string;
  /** e.g. `ceasn:Competency`, or an ESCO/CASE framework identifier. */
  targetType?: string;
}

export interface OB3Achievement {
  id: string;
  type: string[];
  name: string;
  description?: string;
  criteria: OB3Criteria;
  achievementType?: string;
  image?: OB3Image;
  tag?: string[];
  alignment?: OB3Alignment[];
  creator?: string;
  fieldOfStudy?: string;
  humanCode?: string;
  specialization?: string;
  version?: string;
  inLanguage?: string;
}

/**
 * Salted, hashed recipient identity.
 *
 * A badge is a portable file that recipients post publicly. Embedding a plain
 * email address in it turns every shared credential into a scraped address.
 * OB 3.0's `IdentityObject` lets us commit to the address instead: a verifier
 * who already knows the recipient's email can confirm the match, and nobody
 * else learns it. The salt is per-credential, so the same address does not
 * produce a correlatable hash across issuers.
 */
export interface OB3IdentityObject {
  type: 'IdentityObject';
  identityHash: string;
  identityType: 'emailAddress' | 'sourcedId' | 'systemId' | 'name';
  hashed: boolean;
  salt?: string;
}

export function hashedIdentity(
  value: string,
  identityType: OB3IdentityObject['identityType'] = 'emailAddress',
  salt = randomBytes(16).toString('hex'),
): OB3IdentityObject {
  const normalized = identityType === 'emailAddress' ? value.trim().toLowerCase() : value.trim();
  const digest = createHash('sha256').update(`${normalized}${salt}`, 'utf8').digest('hex');
  return {
    type: 'IdentityObject',
    identityHash: `sha256$${digest}`,
    identityType,
    hashed: true,
    salt,
  };
}

export function identityMatches(identity: OB3IdentityObject, candidate: string): boolean {
  if (!identity.hashed) return identity.identityHash === candidate;
  const [algorithm, expected] = identity.identityHash.split('$');
  if (algorithm !== 'sha256') return false;
  const normalized =
    identity.identityType === 'emailAddress' ? candidate.trim().toLowerCase() : candidate.trim();
  const actual = createHash('sha256')
    .update(`${normalized}${identity.salt ?? ''}`, 'utf8')
    .digest('hex');
  return actual === expected;
}

export interface OB3AchievementSubject {
  id?: string;
  type: string[];
  identifier?: OB3IdentityObject[];
  achievement: OB3Achievement;
  activityStartDate?: string;
  activityEndDate?: string;
  creditsEarned?: number;
  licenseNumber?: string;
  role?: string;
  narrative?: string;
  term?: string;
  result?: Array<Record<string, unknown>>;
}

export interface AchievementCredential {
  '@context': string[];
  id: string;
  type: string[];
  name?: string;
  description?: string;
  issuer: OB3Profile;
  validFrom: string;
  validUntil?: string;
  credentialSubject: OB3AchievementSubject;
  credentialStatus?: StatusListEntry | StatusListEntry[];
  credentialSchema?: Array<{ id: string; type: string }>;
  evidence?: Array<Record<string, unknown>>;
  awardedDate?: string;
  proof?: unknown;
  [key: string]: unknown;
}

export interface BuildCredentialInput {
  /** Stable, resolvable credential id. We use `urn:uuid:` + the public id URL. */
  credentialId: string;
  /** Public verification page — becomes `id` on the achievement and evidence. */
  verificationUrl: string;
  issuer: {
    id: string;
    name: string;
    url?: string;
    email?: string;
    description?: string;
    imageUrl?: string;
  };
  recipient: {
    name: string;
    email?: string;
    /** A recipient-held DID, when one is known. Otherwise identity is hashed. */
    did?: string;
    externalId?: string;
  };
  achievement: {
    id?: string;
    name: string;
    description?: string;
    criteriaNarrative?: string;
    criteriaUrl?: string;
    achievementType?: string;
    imageUrl?: string;
    skills?: string[];
    alignment?: OB3Alignment[];
    inLanguage?: string;
  };
  issuedAt: string;
  expiresAt?: string | null;
  status?: StatusListEntry;
  /** Arbitrary issuer data (score, grade, hours) surfaced as OB3 `result`. */
  results?: Array<{ name: string; value: string; type?: string }>;
  narrative?: string;
  evidenceUrl?: string;
  name?: string;
  description?: string;
}

export function buildAchievementCredential(input: BuildCredentialInput): AchievementCredential {
  const identity = input.recipient.email ? [hashedIdentity(input.recipient.email)] : undefined;
  const externalIdentity = input.recipient.externalId
    ? [hashedIdentity(input.recipient.externalId, 'sourcedId')]
    : undefined;

  const identifier = [...(identity ?? []), ...(externalIdentity ?? [])];

  const credential: AchievementCredential = {
    '@context': [VC_V2_CONTEXT, OB3_CONTEXT],
    id: input.credentialId,
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    name: input.name ?? input.achievement.name,
    ...(input.description || input.achievement.description
      ? { description: input.description ?? input.achievement.description }
      : {}),
    issuer: {
      id: input.issuer.id,
      type: ['Profile'],
      name: input.issuer.name,
      ...(input.issuer.url ? { url: input.issuer.url } : {}),
      ...(input.issuer.email ? { email: input.issuer.email } : {}),
      ...(input.issuer.description ? { description: input.issuer.description } : {}),
      ...(input.issuer.imageUrl
        ? { image: { id: input.issuer.imageUrl, type: 'Image' as const } }
        : {}),
    },
    validFrom: input.issuedAt,
    ...(input.expiresAt ? { validUntil: input.expiresAt } : {}),
    awardedDate: input.issuedAt,
    credentialSubject: {
      // A recipient DID when we have one; otherwise the subject is identified
      // only by the salted hash, which keeps the badge shareable without
      // exposing an address.
      ...(input.recipient.did ? { id: input.recipient.did } : {}),
      type: ['AchievementSubject'],
      ...(identifier.length > 0 ? { identifier } : {}),
      ...(input.narrative ? { narrative: input.narrative } : {}),
      ...(input.results && input.results.length > 0
        ? {
            result: input.results.map((r) => ({
              type: ['Result'],
              resultDescription: r.name,
              value: r.value,
              ...(r.type ? { achievedLevel: r.type } : {}),
            })),
          }
        : {}),
      achievement: {
        id: input.achievement.id ?? `${input.verificationUrl}#achievement`,
        type: ['Achievement'],
        name: input.achievement.name,
        ...(input.achievement.description ? { description: input.achievement.description } : {}),
        criteria: {
          ...(input.achievement.criteriaUrl ? { id: input.achievement.criteriaUrl } : {}),
          narrative:
            input.achievement.criteriaNarrative ??
            `Awarded by ${input.issuer.name} on completion of the stated requirements.`,
        },
        ...(input.achievement.achievementType
          ? { achievementType: input.achievement.achievementType }
          : {}),
        ...(input.achievement.imageUrl
          ? { image: { id: input.achievement.imageUrl, type: 'Image' as const } }
          : {}),
        ...(input.achievement.skills && input.achievement.skills.length > 0
          ? { tag: input.achievement.skills }
          : {}),
        ...(input.achievement.alignment && input.achievement.alignment.length > 0
          ? { alignment: input.achievement.alignment }
          : {}),
        ...(input.achievement.inLanguage ? { inLanguage: input.achievement.inLanguage } : {}),
      },
    },
    ...(input.status ? { credentialStatus: input.status } : {}),
    credentialSchema: [
      { id: OB3_ACHIEVEMENT_CREDENTIAL_SCHEMA, type: '1EdTechJsonSchemaValidator2019' },
    ],
    ...(input.evidenceUrl
      ? { evidence: [{ id: input.evidenceUrl, type: ['Evidence'], name: 'Issued credential' }] }
      : {}),
  };

  return credential;
}

/**
 * Structural conformance checks run in CI against every issued shape (§13,
 * step 1). This is not a substitute for the 1EdTech conformance suite — it is
 * the fast local gate that keeps a regression from ever reaching it.
 */
export function validateAchievementCredential(credential: unknown): string[] {
  const errors: string[] = [];
  const c = credential as AchievementCredential;

  if (!c || typeof c !== 'object') return ['credential is not an object'];

  const ctx = c['@context'];
  if (!Array.isArray(ctx) || ctx[0] !== VC_V2_CONTEXT) {
    errors.push(`@context must be an array beginning with ${VC_V2_CONTEXT}`);
  } else if (!ctx.includes(OB3_CONTEXT)) {
    errors.push(`@context must include the Open Badges 3.0 context ${OB3_CONTEXT}`);
  }

  if (typeof c.id !== 'string' || c.id.length === 0) errors.push('id is required');

  if (!Array.isArray(c.type)) errors.push('type must be an array');
  else {
    if (!c.type.includes('VerifiableCredential')) errors.push('type must include VerifiableCredential');
    if (!c.type.includes('OpenBadgeCredential')) errors.push('type must include OpenBadgeCredential');
  }

  if (!c.issuer || typeof c.issuer !== 'object') errors.push('issuer is required');
  else {
    if (typeof c.issuer.id !== 'string') errors.push('issuer.id is required');
    if (!c.issuer.name) errors.push('issuer.name is required');
    const issuerType = Array.isArray(c.issuer.type) ? c.issuer.type : [c.issuer.type];
    if (!issuerType.includes('Profile')) errors.push('issuer.type must include Profile');
  }

  if (typeof c.validFrom !== 'string' || Number.isNaN(Date.parse(c.validFrom))) {
    errors.push('validFrom must be an ISO 8601 date-time');
  }
  if (c.validUntil !== undefined) {
    if (typeof c.validUntil !== 'string' || Number.isNaN(Date.parse(c.validUntil))) {
      errors.push('validUntil must be an ISO 8601 date-time');
    } else if (Date.parse(c.validUntil) <= Date.parse(c.validFrom)) {
      errors.push('validUntil must be later than validFrom');
    }
  }

  const subject = c.credentialSubject;
  if (!subject || typeof subject !== 'object') errors.push('credentialSubject is required');
  else {
    if (!Array.isArray(subject.type) || !subject.type.includes('AchievementSubject')) {
      errors.push('credentialSubject.type must include AchievementSubject');
    }
    const a = subject.achievement;
    if (!a || typeof a !== 'object') errors.push('credentialSubject.achievement is required');
    else {
      if (typeof a.id !== 'string') errors.push('achievement.id is required');
      if (!Array.isArray(a.type) || !a.type.includes('Achievement')) {
        errors.push('achievement.type must include Achievement');
      }
      if (!a.name) errors.push('achievement.name is required');
      if (!a.criteria || (!a.criteria.id && !a.criteria.narrative)) {
        errors.push('achievement.criteria requires at least an id or a narrative');
      }
      if (a.achievementType && !ACHIEVEMENT_TYPES.includes(a.achievementType as AchievementType)) {
        // Extension values are legal but must be namespaced, per the spec.
        if (!a.achievementType.includes(':')) {
          errors.push(
            `achievement.achievementType "${a.achievementType}" is neither a 1EdTech term nor a namespaced extension`,
          );
        }
      }
    }
    if (subject.identifier) {
      for (const ident of subject.identifier) {
        if (ident.type !== 'IdentityObject') errors.push('identifier.type must be IdentityObject');
        if (ident.hashed && !/^(sha256|md5)\$[0-9a-f]+$/.test(ident.identityHash)) {
          errors.push(`identifier.identityHash "${ident.identityHash}" is not a valid hashed form`);
        }
      }
    }
  }

  return errors;
}
