import { z } from 'zod';

/**
 * FR-DES-03 — the template document format.
 *
 * Templates are plain, human-readable JSON. That is a licensing and community
 * decision as much as a technical one: the starter library lives in the repo as
 * reviewable JSON files, so a template contribution is an ordinary pull request
 * a maintainer can read in a diff.
 *
 * The format is deliberately DOM-shaped (absolutely positioned boxes with CSS
 * text properties) rather than canvas-shaped. The editor renders these elements
 * as real DOM nodes and the render worker renders the *same* elements to HTML
 * for Playwright, so the editor preview and the issued PDF come out of one
 * layout engine. A canvas-based editor would need a second, independently
 * drifting print path.
 */

export const UNITS = ['px'] as const;

export const colorSchema = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\)|transparent|currentColor)$/,
    'must be a hex, rgb(a), hsl(a) colour or "transparent"',
  );

export const alignSchema = z.enum(['left', 'center', 'right', 'justify']);
export const verticalAlignSchema = z.enum(['top', 'middle', 'bottom']);

const elementBase = {
  id: z.string().min(1).max(64),
  /** Position and size in template units, measured from the top-left corner. */
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  /**
   * Conditional rendering: when set, the element only renders if the resolved
   * merge value is non-empty. This is what lets one template serve rows with
   * and without an optional field (a grade, a second signature) without
   * maintaining two templates.
   */
  showIf: z.string().max(200).optional(),
};

export const textElementSchema = z.object({
  ...elementBase,
  type: z.literal('text'),
  /** May contain `{{merge.tokens}}`; see merge.ts for the resolution rules. */
  content: z.string().max(5000),
  fontFamily: z.string().max(120).default('Inter'),
  fontSize: z.number().min(1).max(400).default(24),
  fontWeight: z.number().int().min(100).max(900).default(400),
  fontStyle: z.enum(['normal', 'italic']).default('normal'),
  color: colorSchema.default('#111827'),
  align: alignSchema.default('center'),
  verticalAlign: verticalAlignSchema.default('middle'),
  lineHeight: z.number().min(0.5).max(4).default(1.3),
  letterSpacing: z.number().min(-10).max(40).default(0),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).default('none'),
  textDecoration: z.enum(['none', 'underline']).default('none'),
  /**
   * Shrink the text to fit its box instead of overflowing. Names vary wildly in
   * length across a real cohort, so without this a 40-character name silently
   * breaks an otherwise correct batch.
   */
  autoFit: z.boolean().default(true),
  minFontSize: z.number().min(1).max(400).default(10),
});

export const imageElementSchema = z.object({
  ...elementBase,
  type: z.literal('image'),
  /** An https URL, an `opencred://asset/<id>` reference, or a data: URI. */
  src: z.string().max(200000),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
  borderRadius: z.number().min(0).default(0),
  /** Brand-kit binding (FR-DES-04): resolved from the org's kit at render time. */
  brandRef: z.enum(['logo', 'logoMark', 'watermark']).optional(),
});

export const shapeElementSchema = z.object({
  ...elementBase,
  type: z.literal('shape'),
  shape: z.enum(['rectangle', 'ellipse', 'line']),
  fill: colorSchema.default('transparent'),
  stroke: colorSchema.default('#111827'),
  strokeWidth: z.number().min(0).max(100).default(1),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  borderRadius: z.number().min(0).default(0),
  /** Brand-kit binding for palette-driven decoration. */
  brandRef: z.enum(['primary', 'secondary', 'accent']).optional(),
});

export const qrElementSchema = z.object({
  ...elementBase,
  type: z.literal('qr'),
  /**
   * `verification` points at the credential's public verification page — the
   * default, and the only value that satisfies FR-VER-01 on its own.
   */
  source: z.enum(['verification', 'custom']).default('verification'),
  value: z.string().max(2000).optional(),
  foreground: colorSchema.default('#111827'),
  background: colorSchema.default('#ffffff'),
  margin: z.number().int().min(0).max(8).default(1),
  errorCorrection: z.enum(['L', 'M', 'Q', 'H']).default('M'),
});

export const signatureElementSchema = z.object({
  ...elementBase,
  type: z.literal('signature'),
  src: z.string().max(200000),
  /** Brand-kit signature slot, so one template serves multiple signatories. */
  signatureRef: z.string().max(64).optional(),
  name: z.string().max(200).default(''),
  title: z.string().max(200).default(''),
  showRule: z.boolean().default(true),
  color: colorSchema.default('#111827'),
  fontFamily: z.string().max(120).default('Inter'),
  fontSize: z.number().min(1).max(200).default(14),
});

export const elementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
  qrElementSchema,
  signatureElementSchema,
]);

export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type QrElement = z.infer<typeof qrElementSchema>;
export type SignatureElement = z.infer<typeof signatureElementSchema>;
export type TemplateElement = z.infer<typeof elementSchema>;

export const fontSchema = z.object({
  family: z.string().min(1).max(120),
  /**
   * Self-hosted font file. Left empty the renderer falls back to the bundled
   * open-licensed families — a self-hosted install must never need to reach a
   * font CDN to produce a correct PDF.
   */
  src: z.string().max(2000).optional(),
  weight: z.number().int().min(100).max(900).default(400),
  style: z.enum(['normal', 'italic']).default('normal'),
});

export const canvasSchema = z.object({
  width: z.number().min(64).max(20000),
  height: z.number().min(64).max(20000),
  unit: z.enum(UNITS).default('px'),
  background: colorSchema.default('#ffffff'),
  backgroundImage: z.string().max(200000).optional(),
  backgroundFit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  /** Bleed/safe-area guides shown in the editor only; never rendered. */
  safeArea: z.number().min(0).default(0),
});

/**
 * Declared merge fields. The editor uses these to build the column-mapping UI
 * (FR-REC-01) and the validator uses them to reject a CSV before issuance
 * rather than after — a failed 10,000-row batch is a support ticket, a rejected
 * upload is a two-second correction.
 */
export const fieldDefinitionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_.]+$/, 'field keys may contain letters, digits, underscore and dot only'),
  label: z.string().min(1).max(120),
  type: z.enum(['string', 'number', 'date', 'url', 'email']).default('string'),
  required: z.boolean().default(false),
  defaultValue: z.string().max(500).optional(),
  example: z.string().max(500).optional(),
});
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

export const CREDENTIAL_KINDS = ['certificate', 'badge'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];
export const credentialKindSchema = z.enum(CREDENTIAL_KINDS);

export const templateDocumentSchema = z.object({
  /** Bumped only on breaking format changes; the renderer migrates on read. */
  version: z.literal(1).default(1),
  kind: credentialKindSchema.default('certificate'),
  canvas: canvasSchema,
  elements: z.array(elementSchema).max(500),
  fonts: z.array(fontSchema).max(24).default([]),
  fields: z.array(fieldDefinitionSchema).max(64).default([]),
  /** Right-to-left script support (FR-DES-07). */
  direction: z.enum(['ltr', 'rtl']).default('ltr'),
  locale: z.string().max(35).default('en'),
});

export type TemplateDocument = z.infer<typeof templateDocumentSchema>;

/** Library metadata for the starter templates shipped in `@opencred/templates`. */
export const templateLibraryEntrySchema = z.object({
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  category: z.string().min(1).max(80),
  tags: z.array(z.string().max(40)).max(20).default([]),
  kind: credentialKindSchema,
  orientation: z.enum(['landscape', 'portrait', 'square']),
  /** SPDX identifier for the template artwork itself, not the platform code. */
  license: z.string().max(60).default('CC0-1.0'),
  contributor: z.string().max(120).default('OpenCred'),
  document: templateDocumentSchema,
});
export type TemplateLibraryEntry = z.infer<typeof templateLibraryEntrySchema>;

export const A4_LANDSCAPE = { width: 1123, height: 794 } as const;
export const A4_PORTRAIT = { width: 794, height: 1123 } as const;
export const LETTER_LANDSCAPE = { width: 1056, height: 816 } as const;
export const BADGE_SQUARE = { width: 800, height: 800 } as const;

export function emptyTemplate(kind: CredentialKind = 'certificate'): TemplateDocument {
  const size = kind === 'badge' ? BADGE_SQUARE : A4_LANDSCAPE;
  return templateDocumentSchema.parse({
    version: 1,
    kind,
    canvas: { width: size.width, height: size.height, unit: 'px', background: '#ffffff' },
    elements: [],
    fonts: [],
    fields: [],
    direction: 'ltr',
    locale: 'en',
  });
}
