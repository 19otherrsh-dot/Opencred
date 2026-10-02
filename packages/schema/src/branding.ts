import { z } from 'zod';
import { colorSchema } from './template';

/**
 * FR-DES-04 (brand kit) and FR-BRD-01/02 (custom domain, white-labelling).
 *
 * Brand kit values are referenced by templates through `brandRef` rather than
 * copied into them, so re-branding an organisation updates every existing
 * template in one place instead of requiring 150 template edits.
 */

export const brandSignatureSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120).default(''),
  name: z.string().max(200).default(''),
  title: z.string().max(200).default(''),
  /** Stored asset reference (`opencred://asset/<id>`) or data URI. */
  image: z.string().max(200000),
});

export const brandKitSchema = z.object({
  logo: z.string().max(200000).nullable().default(null),
  logoMark: z.string().max(200000).nullable().default(null),
  watermark: z.string().max(200000).nullable().default(null),
  palette: z
    .object({
      primary: colorSchema.default('#1d4ed8'),
      secondary: colorSchema.default('#0f172a'),
      accent: colorSchema.default('#b45309'),
      surface: colorSchema.default('#ffffff'),
      text: colorSchema.default('#111827'),
    })
    .default({}),
  fonts: z
    .object({
      heading: z.string().max(120).default('Inter'),
      body: z.string().max(120).default('Inter'),
      accent: z.string().max(120).default('Playfair Display'),
    })
    .default({}),
  signatures: z.array(brandSignatureSchema).max(20).default([]),
});
export type BrandKit = z.infer<typeof brandKitSchema>;

export const emailBrandingSchema = z.object({
  fromName: z.string().max(120).nullable().default(null),
  replyTo: z.string().email().max(320).nullable().default(null),
  headerImage: z.string().max(2000).nullable().default(null),
  accentColor: colorSchema.default('#1d4ed8'),
  footerText: z.string().max(1000).nullable().default(null),
  subjectTemplate: z
    .string()
    .max(300)
    .default('Your credential from {{issuer.name}} is ready'),
  bodyIntro: z
    .string()
    .max(3000)
    .default('Congratulations {{recipient.first_name}} — your credential has been issued.'),
});
export type EmailBranding = z.infer<typeof emailBrandingSchema>;

export const brandingSettingsSchema = z.object({
  brandKit: brandKitSchema.default({}),
  email: emailBrandingSchema.default({}),
  /**
   * FR-BRD-01 — included on every paid tier, not gated to Enterprise. Several
   * competitors reserve this for their top plan; we treat it as table stakes.
   */
  customDomain: z.string().max(253).nullable().default(null),
  customDomainVerifiedAt: z.string().datetime().nullable().default(null),
  /** FR-BRD-02 — removes every OpenCred mark from recipient-facing surfaces. */
  whiteLabel: z.boolean().default(false),
  verificationPage: z
    .object({
      headline: z.string().max(200).nullable().default(null),
      supportUrl: z.string().max(2000).nullable().default(null),
      showRecipientEmail: z.boolean().default(false),
      showIssuerContact: z.boolean().default(true),
    })
    .default({}),
});
export type BrandingSettings = z.infer<typeof brandingSettingsSchema>;

export function defaultBranding(): BrandingSettings {
  return brandingSettingsSchema.parse({});
}

/**
 * Custom-domain hostnames end up in generated links and DNS instructions, so
 * they get validated strictly rather than trusted from the settings form.
 */
export const hostnameSchema = z
  .string()
  .min(4)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    'must be a valid lowercase hostname such as certs.example.edu',
  );
