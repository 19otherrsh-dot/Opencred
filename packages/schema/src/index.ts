export * from './roles';
export * from './plans';
export * from './template';
export * from './merge';
export * from './credential';
export * from './branding';

/** Deployment modes (Section 10.3). Drives billing, signup and feature gating. */
export const EDITIONS = ['cloud', 'community', 'enterprise'] as const;
export type Edition = (typeof EDITIONS)[number];

export function isSelfHosted(edition: Edition): boolean {
  return edition !== 'cloud';
}
