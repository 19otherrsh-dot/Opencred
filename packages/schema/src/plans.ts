import { z } from 'zod';

/**
 * Section 12 — pricing and packaging.
 *
 * Plans are data, not code branches, and they are served from a public
 * endpoint (`GET /v1/billing/plans`). Publishing the whole matrix — including
 * the Enterprise starting price — is the deliberate counter-position to the
 * sales-gated pricing that the market research flagged as the single most
 * common buyer complaint.
 */
export const PLAN_IDS = ['community', 'free', 'growth', 'scale', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const planIdSchema = z.enum(PLAN_IDS);

export interface PlanFeatures {
  customDomain: boolean;
  whiteLabelEmail: boolean;
  fullWhiteLabel: boolean;
  webhooks: boolean;
  automation: boolean;
  analytics: 'basic' | 'full';
  sso: boolean;
  auditLog: boolean;
  dataResidencyChoice: boolean;
  prioritySupport: boolean;
  apiRateLimitPerMinute: number;
  seats: number | null;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in minor units (USD cents). `null` = custom / not applicable. */
  priceCents: number | null;
  /** Published starting price for Enterprise, so no tier is "Talk to Sales" only. */
  startingAtCents?: number;
  /** FR-BIL-03 — every published tier carries a zero setup fee, on purpose. */
  setupFeeCents: 0;
  annualContractRequired: false;
  /** Included credentials per year. `null` = unlimited. */
  includedCredentialsPerYear: number | null;
  /** Metered overage in USD cents per credential beyond the included volume. */
  overageCentsPerCredential: number | null;
  selfHosted: boolean;
  features: PlanFeatures;
  blurb: string;
}

const base = {
  setupFeeCents: 0 as const,
  annualContractRequired: false as const,
};

export const PLANS: Record<PlanId, Plan> = {
  community: {
    ...base,
    id: 'community',
    name: 'Community Edition (self-hosted)',
    priceCents: 0,
    includedCredentialsPerYear: null,
    overageCentsPerCredential: null,
    selfHosted: true,
    blurb: 'The full core platform under AGPLv3, self-hosted, unlimited credentials, community support.',
    features: {
      customDomain: true,
      whiteLabelEmail: true,
      fullWhiteLabel: true,
      webhooks: true,
      automation: true,
      analytics: 'full',
      sso: false,
      auditLog: true,
      dataResidencyChoice: true,
      prioritySupport: false,
      apiRateLimitPerMinute: 6000,
      seats: null,
    },
  },
  free: {
    ...base,
    id: 'free',
    name: 'Cloud Free',
    priceCents: 0,
    includedCredentialsPerYear: 500,
    overageCentsPerCredential: null,
    selfHosted: false,
    blurb: 'Full design studio, QR verification, LinkedIn add and API access with rate limits.',
    features: {
      customDomain: false,
      whiteLabelEmail: false,
      fullWhiteLabel: false,
      webhooks: false,
      automation: false,
      analytics: 'basic',
      sso: false,
      auditLog: false,
      dataResidencyChoice: false,
      prioritySupport: false,
      apiRateLimitPerMinute: 60,
      seats: 3,
    },
  },
  growth: {
    ...base,
    id: 'growth',
    name: 'Cloud Growth',
    priceCents: 4900,
    includedCredentialsPerYear: 5000,
    overageCentsPerCredential: 2,
    selfHosted: false,
    blurb: 'Custom domain, white-label email, full analytics, n8n automation and webhooks.',
    features: {
      customDomain: true,
      whiteLabelEmail: true,
      fullWhiteLabel: false,
      webhooks: true,
      automation: true,
      analytics: 'full',
      sso: false,
      auditLog: true,
      dataResidencyChoice: false,
      prioritySupport: false,
      apiRateLimitPerMinute: 600,
      seats: 10,
    },
  },
  scale: {
    ...base,
    id: 'scale',
    name: 'Cloud Scale',
    priceCents: 19900,
    includedCredentialsPerYear: 25000,
    overageCentsPerCredential: 1,
    selfHosted: false,
    blurb: 'Full white-label, SSO, priority support and higher API limits.',
    features: {
      customDomain: true,
      whiteLabelEmail: true,
      fullWhiteLabel: true,
      webhooks: true,
      automation: true,
      analytics: 'full',
      sso: true,
      auditLog: true,
      dataResidencyChoice: false,
      prioritySupport: true,
      apiRateLimitPerMinute: 2400,
      seats: 50,
    },
  },
  enterprise: {
    ...base,
    id: 'enterprise',
    name: 'Enterprise (Cloud or self-hosted)',
    priceCents: null,
    startingAtCents: 99900,
    includedCredentialsPerYear: null,
    overageCentsPerCredential: null,
    selfHosted: true,
    blurb: 'SLA, dedicated support, Enterprise module, data-residency choice. Starting price published, not sales-gated.',
    features: {
      customDomain: true,
      whiteLabelEmail: true,
      fullWhiteLabel: true,
      webhooks: true,
      automation: true,
      analytics: 'full',
      sso: true,
      auditLog: true,
      dataResidencyChoice: true,
      prioritySupport: true,
      apiRateLimitPerMinute: 12000,
      seats: null,
    },
  },
};

/** Plans a customer can move between without talking to anyone (FR-BIL-01). */
export const SELF_SERVE_PLANS: readonly PlanId[] = ['free', 'growth', 'scale'];

export function planFor(id: string | null | undefined): Plan {
  const parsed = planIdSchema.safeParse(id);
  return parsed.success ? PLANS[parsed.data] : PLANS.free;
}
