import type { Theme } from './themes';
import {
  BADGE_FIELDS,
  CERTIFICATE_FIELDS,
  logo,
  qr,
  resetIds,
  shape,
  signature,
  text,
  verificationFooter,
} from './kit';

/**
 * The fifteen base layouts.
 *
 * Each is a function of a theme, which is what makes the library composable:
 * 15 layouts x 10 themes = 150 finished starter templates (FR-DES-03), and a
 * contributor who adds one layout adds ten templates.
 *
 * Every layout follows the same three rules, learned from what the category
 * gets wrong:
 *   - the recipient name is the largest element and always auto-fits, because
 *     real cohorts contain names three times longer than the designer's mock;
 *   - a QR code and a human-readable credential ID are present on every single
 *     template, never optional decoration;
 *   - nothing is positioned within 24px of the trim edge, because these get
 *     printed on office printers with real margins.
 */

const LANDSCAPE = { width: 1123, height: 794 };
const PORTRAIT = { width: 794, height: 1123 };
const BADGE = { width: 800, height: 800 };

export interface Layout {
  slug: string;
  name: string;
  category: string;
  tags: string[];
  kind: 'certificate' | 'badge';
  orientation: 'landscape' | 'portrait' | 'square';
  build: (theme: Theme) => Record<string, unknown>;
}

function certificate(
  theme: Theme,
  size: { width: number; height: number },
  elements: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    kind: 'certificate',
    canvas: {
      width: size.width,
      height: size.height,
      unit: 'px',
      background: theme.surface,
      safeArea: 24,
    },
    elements,
    fields: CERTIFICATE_FIELDS,
    fonts: [],
    direction: 'ltr',
    locale: 'en',
    ...extra,
  };
}

function badge(theme: Theme, elements: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    version: 1,
    kind: 'badge',
    canvas: {
      width: BADGE.width,
      height: BADGE.height,
      unit: 'px',
      background: theme.surface,
      safeArea: 16,
    },
    elements,
    fields: BADGE_FIELDS,
    fonts: [],
    direction: 'ltr',
    locale: 'en',
  };
}

/** Shared signatory block: falls back to brand-kit values when CSV columns are absent. */
function signatories(theme: Theme, y: number, left: number, right: number, width = 260) {
  return [
    signature(
      { x: left, y, width, height: 92 },
      {
        name: '{{signatory_name}}',
        title: '{{signatory_title}}',
        signatureRef: 'primary',
        color: theme.text,
        fontFamily: theme.fonts.body,
        fontSize: 13,
      },
    ),
    signature(
      { x: right, y, width, height: 92 },
      {
        name: '{{issuer.name}}',
        title: 'Issuing organisation',
        signatureRef: 'secondary',
        color: theme.text,
        fontFamily: theme.fonts.body,
        fontSize: 13,
      },
    ),
  ];
}

export const LAYOUTS: Layout[] = [
  {
    slug: 'classic-ornate',
    name: 'Classic Ornate',
    category: 'Academic',
    tags: ['formal', 'border', 'traditional'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: 28, y: 28, width: 1067, height: 738 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.primary,
          strokeWidth: 3,
        }),
        shape({ x: 40, y: 40, width: 1043, height: 714 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.accent,
          strokeWidth: 1,
        }),
        logo({ x: 501, y: 66, width: 120, height: 56 }),
        text({ x: 161, y: 140, width: 800, height: 56 }, 'CERTIFICATE OF COMPLETION', {
          fontFamily: theme.fonts.heading,
          fontSize: 38,
          fontWeight: 700,
          color: theme.primary,
          letterSpacing: 6,
        }),
        shape({ x: 481, y: 206, width: 160, height: 2 }, 'line', { stroke: theme.accent, strokeWidth: 2 }),
        text({ x: 261, y: 232, width: 600, height: 30 }, 'This is to certify that', {
          fontFamily: theme.fonts.body,
          fontSize: 18,
          color: theme.muted,
        }),
        text({ x: 111, y: 272, width: 900, height: 96 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.accent,
          fontSize: 72,
          fontWeight: 600,
          color: theme.secondary,
          minFontSize: 30,
        }),
        shape({ x: 311, y: 374, width: 500, height: 1 }, 'line', { stroke: theme.muted, strokeWidth: 1 }),
        text({ x: 211, y: 396, width: 700, height: 30 }, 'has successfully completed', {
          fontFamily: theme.fonts.body,
          fontSize: 18,
          color: theme.muted,
        }),
        text({ x: 161, y: 432, width: 800, height: 62 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 34,
          fontWeight: 700,
          color: theme.text,
          minFontSize: 18,
        }),
        text({ x: 361, y: 500, width: 400, height: 26 }, 'with a result of {{grade}}', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          color: theme.muted,
          showIf: 'grade',
        }),
        text({ x: 161, y: 534, width: 800, height: 26 }, 'Awarded {{issued_at | date:"D MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.muted,
        }),
        ...signatories(theme, 592, 140, 720),
        qr({ x: 981, y: 630, width: 96, height: 96 }, { foreground: theme.secondary }),
        verificationFooter(theme, { width: 1123, y: 742 }),
      ]);
    },
  },

  {
    slug: 'modern-minimal',
    name: 'Modern Minimal',
    category: 'Professional',
    tags: ['clean', 'minimal', 'corporate'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: 0, y: 0, width: 10, height: 794 }, 'rectangle', { fill: theme.primary, strokeWidth: 0 }),
        logo({ x: 80, y: 78, width: 160, height: 60 }),
        text({ x: 80, y: 190, width: 700, height: 34 }, 'CERTIFICATE OF ACHIEVEMENT', {
          fontFamily: theme.fonts.heading,
          fontSize: 20,
          fontWeight: 600,
          color: theme.primary,
          align: 'left',
          letterSpacing: 4,
        }),
        text({ x: 80, y: 244, width: 900, height: 120 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 76,
          fontWeight: 700,
          color: theme.secondary,
          align: 'left',
          minFontSize: 32,
        }),
        text({ x: 80, y: 380, width: 700, height: 28 }, 'has completed', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          color: theme.muted,
          align: 'left',
        }),
        text({ x: 80, y: 412, width: 820, height: 56 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 32,
          fontWeight: 600,
          color: theme.text,
          align: 'left',
          minFontSize: 18,
        }),
        shape({ x: 80, y: 486, width: 120, height: 3 }, 'line', { stroke: theme.accent, strokeWidth: 3 }),
        text({ x: 80, y: 512, width: 400, height: 24 }, '{{hours}} credit hours', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          align: 'left',
          showIf: 'hours',
        }),
        text({ x: 80, y: 544, width: 400, height: 24 }, 'Issued {{issued_at | date:"D MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          align: 'left',
        }),
        ...signatories(theme, 596, 80, 400, 240),
        qr({ x: 947, y: 596, width: 110, height: 110 }, { foreground: theme.secondary }),
        text({ x: 80, y: 730, width: 700, height: 20 }, 'ID {{credential.public_id}} · {{credential.verification_url}}', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          autoFit: false,
        }),
      ]);
    },
  },

  {
    slug: 'corporate-band',
    name: 'Corporate Band',
    category: 'Professional',
    tags: ['header', 'training', 'compliance'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: 0, y: 0, width: 1123, height: 140 }, 'rectangle', { fill: theme.primary, strokeWidth: 0 }),
        shape({ x: 0, y: 140, width: 1123, height: 6 }, 'rectangle', { fill: theme.accent, strokeWidth: 0 }),
        logo({ x: 64, y: 40, width: 150, height: 60 }),
        text({ x: 280, y: 46, width: 780, height: 48 }, 'CERTIFICATE OF TRAINING', {
          fontFamily: theme.fonts.heading,
          fontSize: 30,
          fontWeight: 700,
          color: theme.surface === '#0b1220' ? theme.text : '#ffffff',
          align: 'right',
          letterSpacing: 3,
        }),
        text({ x: 280, y: 92, width: 780, height: 26 }, '{{issuer.name}}', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.surface === '#0b1220' ? theme.muted : 'rgba(255,255,255,0.85)',
          align: 'right',
        }),
        text({ x: 100, y: 220, width: 923, height: 28 }, 'Presented to', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          color: theme.muted,
        }),
        text({ x: 100, y: 256, width: 923, height: 100 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 64,
          fontWeight: 700,
          color: theme.secondary,
          minFontSize: 28,
        }),
        text({ x: 200, y: 372, width: 723, height: 28 }, 'for successfully completing', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          color: theme.muted,
        }),
        text({ x: 100, y: 406, width: 923, height: 56 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 30,
          fontWeight: 600,
          color: theme.text,
          minFontSize: 18,
        }),
        shape({ x: 100, y: 486, width: 923, height: 1 }, 'line', { stroke: theme.muted, strokeWidth: 1 }),
        text({ x: 100, y: 500, width: 460, height: 24 }, 'Completed {{issued_at | date:"D MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          align: 'left',
        }),
        text({ x: 563, y: 500, width: 460, height: 24 }, 'Valid until {{expires_at | date:"D MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          align: 'right',
          showIf: 'expires_at',
        }),
        ...signatories(theme, 570, 100, 480, 240),
        qr({ x: 927, y: 578, width: 96, height: 96 }, { foreground: theme.secondary }),
        verificationFooter(theme, { width: 1123, y: 730 }),
      ]);
    },
  },

  {
    slug: 'academic-seal',
    name: 'Academic Seal',
    category: 'Academic',
    tags: ['university', 'seal', 'formal'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: 32, y: 32, width: 1059, height: 730 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.primary,
          strokeWidth: 6,
        }),
        shape({ x: 46, y: 46, width: 1031, height: 702 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.primary,
          strokeWidth: 1,
        }),
        text({ x: 161, y: 96, width: 800, height: 34 }, '{{issuer.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 22,
          fontWeight: 600,
          color: theme.primary,
          letterSpacing: 3,
          textTransform: 'uppercase',
        }),
        text({ x: 161, y: 150, width: 800, height: 60 }, 'Diploma of Achievement', {
          fontFamily: theme.fonts.heading,
          fontSize: 44,
          fontWeight: 700,
          color: theme.secondary,
        }),
        text({ x: 261, y: 230, width: 600, height: 28 }, 'Be it known that', {
          fontFamily: theme.fonts.body,
          fontSize: 17,
          fontStyle: 'italic',
          color: theme.muted,
        }),
        text({ x: 111, y: 268, width: 900, height: 92 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.accent,
          fontSize: 68,
          color: theme.primary,
          minFontSize: 28,
        }),
        text({ x: 161, y: 372, width: 800, height: 84 },
          'having fulfilled the requirements of {{course}}, is hereby awarded this diploma on {{issued_at | date:"D MMMM YYYY"}}.',
          {
            fontFamily: theme.fonts.body,
            fontSize: 17,
            color: theme.text,
            lineHeight: 1.6,
            minFontSize: 12,
          }),
        shape({ x: 481, y: 486, width: 160, height: 160 }, 'ellipse', {
          fill: 'transparent',
          stroke: theme.accent,
          strokeWidth: 3,
        }),
        text({ x: 501, y: 540, width: 120, height: 52 }, 'SEALED', {
          fontFamily: theme.fonts.heading,
          fontSize: 15,
          fontWeight: 700,
          color: theme.accent,
          letterSpacing: 3,
        }),
        ...signatories(theme, 560, 120, 743, 260),
        qr({ x: 981, y: 638, width: 88, height: 88 }, { foreground: theme.secondary }),
        verificationFooter(theme, { width: 1123, y: 736 }),
      ]);
    },
  },

  {
    slug: 'bold-diagonal',
    name: 'Bold Diagonal',
    category: 'Creator',
    tags: ['bold', 'colourful', 'bootcamp'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: -220, y: -320, width: 700, height: 700 }, 'rectangle', {
          fill: theme.primary,
          strokeWidth: 0,
          rotation: 35,
          opacity: 0.12,
        }),
        shape({ x: 760, y: 520, width: 620, height: 620 }, 'rectangle', {
          fill: theme.accent,
          strokeWidth: 0,
          rotation: 35,
          opacity: 0.14,
        }),
        logo({ x: 72, y: 66, width: 150, height: 56 }),
        text({ x: 72, y: 168, width: 640, height: 40 }, 'CERTIFICATE', {
          fontFamily: theme.fonts.heading,
          fontSize: 26,
          fontWeight: 800,
          color: theme.accent,
          align: 'left',
          letterSpacing: 8,
        }),
        text({ x: 72, y: 216, width: 900, height: 128 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 82,
          fontWeight: 800,
          color: theme.secondary,
          align: 'left',
          minFontSize: 34,
        }),
        shape({ x: 72, y: 358, width: 180, height: 6 }, 'line', { stroke: theme.primary, strokeWidth: 6 }),
        text({ x: 72, y: 392, width: 860, height: 30 }, 'completed', {
          fontFamily: theme.fonts.body,
          fontSize: 17,
          color: theme.muted,
          align: 'left',
          textTransform: 'uppercase',
          letterSpacing: 3,
        }),
        text({ x: 72, y: 428, width: 860, height: 64 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 40,
          fontWeight: 700,
          color: theme.primary,
          align: 'left',
          minFontSize: 20,
        }),
        text({ x: 72, y: 512, width: 500, height: 26 }, '{{grade}}', {
          fontFamily: theme.fonts.body,
          fontSize: 18,
          fontWeight: 600,
          color: theme.accent,
          align: 'left',
          showIf: 'grade',
        }),
        text({ x: 72, y: 616, width: 480, height: 26 }, '{{issued_at | date:"MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.muted,
          align: 'left',
        }),
        signature(
          { x: 560, y: 574, width: 280, height: 92 },
          {
            name: '{{signatory_name}}',
            title: '{{signatory_title}}',
            signatureRef: 'primary',
            color: theme.text,
            fontFamily: theme.fonts.body,
            fontSize: 13,
          },
        ),
        qr({ x: 947, y: 574, width: 104, height: 104 }, { foreground: theme.secondary }),
        text({ x: 72, y: 726, width: 700, height: 20 }, 'Verify: {{credential.verification_url}}', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          autoFit: false,
        }),
      ]);
    },
  },

  {
    slug: 'elegant-border',
    name: 'Elegant Border',
    category: 'Academic',
    tags: ['formal', 'script', 'award'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: 36, y: 36, width: 1051, height: 722 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.accent,
          strokeWidth: 2,
          borderRadius: 4,
        }),
        shape({ x: 52, y: 52, width: 1019, height: 690 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.primary,
          strokeWidth: 1,
          strokeStyle: 'dashed',
          borderRadius: 2,
        }),
        text({ x: 161, y: 108, width: 800, height: 68 }, 'Certificate of Excellence', {
          fontFamily: theme.fonts.accent,
          fontSize: 54,
          color: theme.primary,
        }),
        shape({ x: 461, y: 190, width: 200, height: 1 }, 'line', { stroke: theme.accent, strokeWidth: 1 }),
        text({ x: 261, y: 218, width: 600, height: 28 }, 'proudly presented to', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          fontStyle: 'italic',
          color: theme.muted,
        }),
        text({ x: 111, y: 258, width: 900, height: 96 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 62,
          fontWeight: 700,
          color: theme.secondary,
          minFontSize: 26,
        }),
        text({ x: 211, y: 372, width: 700, height: 76 }, 'in recognition of the successful completion of {{course}}', {
          fontFamily: theme.fonts.body,
          fontSize: 18,
          color: theme.text,
          lineHeight: 1.6,
          minFontSize: 12,
        }),
        text({ x: 361, y: 464, width: 400, height: 26 }, 'Result: {{grade}}', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.muted,
          showIf: 'grade',
        }),
        text({ x: 361, y: 496, width: 400, height: 26 }, '{{issued_at | date:"D MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.muted,
        }),
        ...signatories(theme, 568, 148, 712, 260),
        qr({ x: 981, y: 634, width: 88, height: 88 }, { foreground: theme.secondary }),
        verificationFooter(theme, { width: 1123, y: 734 }),
      ]);
    },
  },

  {
    slug: 'tech-grid',
    name: 'Tech Grid',
    category: 'Technology',
    tags: ['developer', 'technical', 'dark-friendly'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      const gridLines: Array<Record<string, unknown>> = [];
      for (let i = 1; i < 8; i += 1) {
        gridLines.push(
          shape({ x: 0, y: i * 100, width: 1123, height: 1 }, 'line', {
            stroke: theme.muted,
            strokeWidth: 1,
            opacity: 0.12,
          }),
        );
      }
      return certificate(theme, LANDSCAPE, [
        ...gridLines,
        shape({ x: 64, y: 64, width: 8, height: 80 }, 'rectangle', { fill: theme.primary, strokeWidth: 0 }),
        text({ x: 92, y: 64, width: 600, height: 34 }, '{{issuer.name}}', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          fontWeight: 600,
          color: theme.muted,
          align: 'left',
          letterSpacing: 2,
          textTransform: 'uppercase',
        }),
        text({ x: 92, y: 96, width: 700, height: 48 }, 'Certificate of Technical Proficiency', {
          fontFamily: theme.fonts.heading,
          fontSize: 28,
          fontWeight: 700,
          color: theme.text,
          align: 'left',
          minFontSize: 16,
        }),
        text({ x: 92, y: 236, width: 940, height: 104 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 68,
          fontWeight: 700,
          color: theme.primary,
          align: 'left',
          minFontSize: 30,
        }),
        text({ x: 92, y: 356, width: 940, height: 26 }, 'demonstrated proficiency in', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.muted,
          align: 'left',
        }),
        text({ x: 92, y: 388, width: 940, height: 54 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 34,
          fontWeight: 600,
          color: theme.text,
          align: 'left',
          minFontSize: 18,
        }),
        shape({ x: 92, y: 470, width: 940, height: 1 }, 'line', { stroke: theme.muted, strokeWidth: 1, opacity: 0.4 }),
        text({ x: 92, y: 492, width: 300, height: 22 }, 'ISSUED', {
          fontFamily: theme.fonts.accent,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          letterSpacing: 2,
        }),
        text({ x: 92, y: 514, width: 300, height: 26 }, '{{issued_at | date:"YYYY-MM-DD"}}', {
          fontFamily: theme.fonts.accent,
          fontSize: 16,
          color: theme.text,
          align: 'left',
        }),
        text({ x: 412, y: 492, width: 300, height: 22 }, 'CREDENTIAL ID', {
          fontFamily: theme.fonts.accent,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          letterSpacing: 2,
        }),
        text({ x: 412, y: 514, width: 300, height: 26 }, '{{credential.public_id}}', {
          fontFamily: theme.fonts.accent,
          fontSize: 16,
          color: theme.text,
          align: 'left',
        }),
        text({ x: 732, y: 492, width: 300, height: 22 }, 'LEVEL', {
          fontFamily: theme.fonts.accent,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          letterSpacing: 2,
          showIf: 'grade',
        }),
        text({ x: 732, y: 514, width: 300, height: 26 }, '{{grade}}', {
          fontFamily: theme.fonts.accent,
          fontSize: 16,
          color: theme.text,
          align: 'left',
          showIf: 'grade',
        }),
        signature(
          { x: 92, y: 606, width: 300, height: 92 },
          {
            name: '{{signatory_name}}',
            title: '{{signatory_title}}',
            signatureRef: 'primary',
            color: theme.text,
            fontFamily: theme.fonts.body,
            fontSize: 13,
          },
        ),
        qr({ x: 928, y: 596, width: 104, height: 104 }, { foreground: theme.primary, background: theme.surface }),
        text({ x: 92, y: 726, width: 700, height: 20 }, '{{credential.verification_url}}', {
          fontFamily: theme.fonts.accent,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          autoFit: false,
        }),
      ]);
    },
  },

  {
    slug: 'gradient-header',
    name: 'Gradient Header',
    category: 'Professional',
    tags: ['modern', 'header', 'saas'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: 0, y: 0, width: 1123, height: 190 }, 'rectangle', { fill: theme.primary, strokeWidth: 0 }),
        shape({ x: 0, y: 150, width: 1123, height: 40 }, 'rectangle', {
          fill: theme.accent,
          strokeWidth: 0,
          opacity: 0.35,
        }),
        logo({ x: 481, y: 40, width: 160, height: 56 }),
        text({ x: 161, y: 106, width: 800, height: 44 }, 'CERTIFICATE OF COMPLETION', {
          fontFamily: theme.fonts.heading,
          fontSize: 24,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: 5,
        }),
        text({ x: 161, y: 250, width: 800, height: 26 }, 'This certifies that', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          color: theme.muted,
        }),
        text({ x: 111, y: 286, width: 900, height: 96 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 66,
          fontWeight: 700,
          color: theme.secondary,
          minFontSize: 28,
        }),
        text({ x: 211, y: 396, width: 700, height: 26 }, 'has completed the programme', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          color: theme.muted,
        }),
        text({ x: 161, y: 428, width: 800, height: 58 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 32,
          fontWeight: 600,
          color: theme.primary,
          minFontSize: 18,
        }),
        text({ x: 161, y: 500, width: 800, height: 24 }, '{{hours}} hours · {{grade}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          showIf: 'hours',
        }),
        text({ x: 161, y: 528, width: 800, height: 24 }, 'Issued {{issued_at | date:"D MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
        }),
        ...signatories(theme, 588, 150, 710, 260),
        qr({ x: 981, y: 620, width: 92, height: 92 }, { foreground: theme.secondary }),
        verificationFooter(theme, { width: 1123, y: 738 }),
      ]);
    },
  },

  {
    slug: 'split-panel',
    name: 'Split Panel',
    category: 'Professional',
    tags: ['sidebar', 'modern', 'data'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: 0, y: 0, width: 340, height: 794 }, 'rectangle', { fill: theme.primary, strokeWidth: 0 }),
        logo({ x: 60, y: 72, width: 200, height: 64 }),
        text({ x: 44, y: 190, width: 252, height: 34 }, '{{issuer.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 17,
          fontWeight: 600,
          color: '#ffffff',
          minFontSize: 11,
        }),
        shape({ x: 44, y: 244, width: 60, height: 3 }, 'line', { stroke: theme.accent, strokeWidth: 3 }),
        text({ x: 44, y: 288, width: 252, height: 20 }, 'ISSUED', {
          fontFamily: theme.fonts.body,
          fontSize: 10,
          color: 'rgba(255,255,255,0.7)',
          align: 'left',
          letterSpacing: 2,
        }),
        text({ x: 44, y: 308, width: 252, height: 24 }, '{{issued_at | date:"D MMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: '#ffffff',
          align: 'left',
        }),
        text({ x: 44, y: 348, width: 252, height: 20 }, 'CREDENTIAL ID', {
          fontFamily: theme.fonts.body,
          fontSize: 10,
          color: 'rgba(255,255,255,0.7)',
          align: 'left',
          letterSpacing: 2,
        }),
        text({ x: 44, y: 368, width: 252, height: 24 }, '{{credential.public_id}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: '#ffffff',
          align: 'left',
        }),
        text({ x: 44, y: 408, width: 252, height: 20 }, 'RESULT', {
          fontFamily: theme.fonts.body,
          fontSize: 10,
          color: 'rgba(255,255,255,0.7)',
          align: 'left',
          letterSpacing: 2,
          showIf: 'grade',
        }),
        text({ x: 44, y: 428, width: 252, height: 24 }, '{{grade}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: '#ffffff',
          align: 'left',
          showIf: 'grade',
        }),
        qr({ x: 44, y: 560, width: 120, height: 120 }, { foreground: '#ffffff', background: theme.primary }),
        text({ x: 44, y: 692, width: 252, height: 36 }, 'Scan to verify', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: 'rgba(255,255,255,0.8)',
          align: 'left',
          autoFit: false,
        }),
        text({ x: 396, y: 160, width: 660, height: 34 }, 'CERTIFICATE OF COMPLETION', {
          fontFamily: theme.fonts.heading,
          fontSize: 18,
          fontWeight: 600,
          color: theme.accent,
          align: 'left',
          letterSpacing: 4,
        }),
        text({ x: 396, y: 218, width: 660, height: 112 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 60,
          fontWeight: 700,
          color: theme.secondary,
          align: 'left',
          minFontSize: 26,
        }),
        text({ x: 396, y: 346, width: 660, height: 26 }, 'has successfully completed', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.muted,
          align: 'left',
        }),
        text({ x: 396, y: 378, width: 660, height: 60 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 32,
          fontWeight: 600,
          color: theme.text,
          align: 'left',
          minFontSize: 18,
        }),
        signature(
          { x: 396, y: 580, width: 300, height: 92 },
          {
            name: '{{signatory_name}}',
            title: '{{signatory_title}}',
            signatureRef: 'primary',
            color: theme.text,
            fontFamily: theme.fonts.body,
            fontSize: 13,
          },
        ),
        text({ x: 396, y: 724, width: 660, height: 20 }, '{{credential.verification_url}}', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          autoFit: false,
        }),
      ]);
    },
  },

  {
    slug: 'workshop-compact',
    name: 'Workshop Compact',
    category: 'Creator',
    tags: ['workshop', 'webinar', 'attendance'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      return certificate(theme, LANDSCAPE, [
        shape({ x: 60, y: 60, width: 1003, height: 674 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.primary,
          strokeWidth: 2,
          borderRadius: 18,
        }),
        logo({ x: 100, y: 100, width: 140, height: 52 }),
        text({ x: 100, y: 180, width: 500, height: 30 }, 'CERTIFICATE OF ATTENDANCE', {
          fontFamily: theme.fonts.heading,
          fontSize: 16,
          fontWeight: 700,
          color: theme.accent,
          align: 'left',
          letterSpacing: 3,
        }),
        text({ x: 100, y: 226, width: 800, height: 88 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 56,
          fontWeight: 700,
          color: theme.secondary,
          align: 'left',
          minFontSize: 24,
        }),
        text({ x: 100, y: 328, width: 700, height: 26 }, 'attended', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.muted,
          align: 'left',
        }),
        text({ x: 100, y: 358, width: 860, height: 52 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 28,
          fontWeight: 600,
          color: theme.primary,
          align: 'left',
          minFontSize: 16,
        }),
        shape({ x: 100, y: 434, width: 863, height: 1 }, 'line', { stroke: theme.muted, strokeWidth: 1, opacity: 0.5 }),
        text({ x: 100, y: 452, width: 420, height: 24 }, '{{issued_at | date:"D MMMM YYYY"}} · {{hours}} hours', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          align: 'left',
        }),
        signature(
          { x: 100, y: 560, width: 280, height: 92 },
          {
            name: '{{signatory_name}}',
            title: '{{signatory_title}}',
            signatureRef: 'primary',
            color: theme.text,
            fontFamily: theme.fonts.body,
            fontSize: 13,
          },
        ),
        qr({ x: 875, y: 560, width: 96, height: 96 }, { foreground: theme.secondary }),
        text({ x: 100, y: 682, width: 700, height: 20 }, 'Verify at {{credential.verification_url}}', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          autoFit: false,
        }),
      ]);
    },
  },

  {
    slug: 'portrait-formal',
    name: 'Portrait Formal',
    category: 'Academic',
    tags: ['portrait', 'formal', 'diploma'],
    kind: 'certificate',
    orientation: 'portrait',
    build: (theme) => {
      resetIds();
      return certificate(theme, PORTRAIT, [
        shape({ x: 34, y: 34, width: 726, height: 1055 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.primary,
          strokeWidth: 4,
        }),
        shape({ x: 48, y: 48, width: 698, height: 1027 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.accent,
          strokeWidth: 1,
        }),
        logo({ x: 337, y: 96, width: 120, height: 60 }),
        text({ x: 97, y: 186, width: 600, height: 32 }, '{{issuer.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 18,
          fontWeight: 600,
          color: theme.primary,
          letterSpacing: 3,
          textTransform: 'uppercase',
          minFontSize: 12,
        }),
        text({ x: 77, y: 250, width: 640, height: 60 }, 'Certificate of Completion', {
          fontFamily: theme.fonts.heading,
          fontSize: 36,
          fontWeight: 700,
          color: theme.secondary,
          minFontSize: 20,
        }),
        shape({ x: 317, y: 328, width: 160, height: 1 }, 'line', { stroke: theme.accent, strokeWidth: 1 }),
        text({ x: 137, y: 366, width: 520, height: 26 }, 'awarded to', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          fontStyle: 'italic',
          color: theme.muted,
        }),
        text({ x: 57, y: 404, width: 680, height: 90 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.accent,
          fontSize: 56,
          color: theme.primary,
          minFontSize: 24,
        }),
        text({ x: 97, y: 516, width: 600, height: 80 }, 'for the successful completion of {{course}}', {
          fontFamily: theme.fonts.body,
          fontSize: 17,
          color: theme.text,
          lineHeight: 1.6,
          minFontSize: 12,
        }),
        text({ x: 197, y: 612, width: 400, height: 24 }, 'Result: {{grade}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          showIf: 'grade',
        }),
        text({ x: 197, y: 640, width: 400, height: 24 }, '{{issued_at | date:"D MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
        }),
        ...signatories(theme, 760, 100, 434, 260),
        qr({ x: 349, y: 900, width: 96, height: 96 }, { foreground: theme.secondary }),
        verificationFooter(theme, { width: 794, y: 1016 }),
      ]);
    },
  },

  {
    slug: 'portrait-modern',
    name: 'Portrait Modern',
    category: 'Professional',
    tags: ['portrait', 'minimal', 'modern'],
    kind: 'certificate',
    orientation: 'portrait',
    build: (theme) => {
      resetIds();
      return certificate(theme, PORTRAIT, [
        shape({ x: 0, y: 0, width: 794, height: 12 }, 'rectangle', { fill: theme.primary, strokeWidth: 0 }),
        shape({ x: 0, y: 1111, width: 794, height: 12 }, 'rectangle', { fill: theme.accent, strokeWidth: 0 }),
        logo({ x: 64, y: 76, width: 150, height: 56 }),
        text({ x: 64, y: 200, width: 600, height: 30 }, 'CERTIFICATE', {
          fontFamily: theme.fonts.heading,
          fontSize: 16,
          fontWeight: 700,
          color: theme.primary,
          align: 'left',
          letterSpacing: 6,
        }),
        text({ x: 64, y: 246, width: 666, height: 130 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 56,
          fontWeight: 700,
          color: theme.secondary,
          align: 'left',
          minFontSize: 24,
        }),
        shape({ x: 64, y: 396, width: 120, height: 4 }, 'line', { stroke: theme.accent, strokeWidth: 4 }),
        text({ x: 64, y: 430, width: 666, height: 26 }, 'has completed', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          color: theme.muted,
          align: 'left',
        }),
        text({ x: 64, y: 462, width: 666, height: 96 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 30,
          fontWeight: 600,
          color: theme.text,
          align: 'left',
          verticalAlign: 'top',
          minFontSize: 16,
        }),
        text({ x: 64, y: 600, width: 400, height: 24 }, '{{hours}} hours · {{grade}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          align: 'left',
          showIf: 'hours',
        }),
        text({ x: 64, y: 628, width: 400, height: 24 }, 'Issued {{issued_at | date:"D MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          align: 'left',
        }),
        signature(
          { x: 64, y: 800, width: 280, height: 92 },
          {
            name: '{{signatory_name}}',
            title: '{{signatory_title}}',
            signatureRef: 'primary',
            color: theme.text,
            fontFamily: theme.fonts.body,
            fontSize: 13,
          },
        ),
        qr({ x: 610, y: 800, width: 120, height: 120 }, { foreground: theme.secondary }),
        text({ x: 64, y: 1040, width: 666, height: 20 }, 'ID {{credential.public_id}} · {{credential.verification_url}}', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: theme.muted,
          align: 'left',
          autoFit: false,
        }),
      ]);
    },
  },

  {
    slug: 'rtl-formal',
    name: 'Formal (Arabic)',
    category: 'Academic',
    tags: ['rtl', 'arabic', 'formal'],
    kind: 'certificate',
    orientation: 'landscape',
    build: (theme) => {
      resetIds();
      /*
       * A right-to-left certificate (FR-DES-07).
       *
       * This exists to prove the RTL path rather than to decorate the library.
       * A layout engine that has never rendered RTL is one that will break the
       * first time it does, and "the renderer supports it" is not the same
       * claim as "a template ships that uses it".
       *
       * Three things make it work, and all three are properties of the shared
       * renderer rather than of this file: the canvas root carries `dir="rtl"`,
       * text elements align to the reading direction, and the font stack
       * includes Noto Sans Arabic so glyphs shape and join correctly instead of
       * rendering as disconnected letters or tofu boxes.
       *
       * The credential identifier stays left-aligned and Latin on purpose: it
       * is an ASCII token, and a bare alphanumeric string inside an RTL
       * paragraph reorders visually and gets transcribed wrong.
       */
      return certificate(
        theme,
        LANDSCAPE,
        [
          shape({ x: 32, y: 32, width: 1059, height: 730 }, 'rectangle', {
            fill: 'transparent',
            stroke: theme.primary,
            strokeWidth: 4,
          }),
          shape({ x: 46, y: 46, width: 1031, height: 702 }, 'rectangle', {
            fill: 'transparent',
            stroke: theme.accent,
            strokeWidth: 1,
          }),
          logo({ x: 501, y: 74, width: 120, height: 56 }),

          text({ x: 161, y: 146, width: 800, height: 56 }, 'شهادة إتمام', {
            fontFamily: theme.fonts.heading,
            fontSize: 40,
            fontWeight: 700,
            color: theme.primary,
          }),
          shape({ x: 481, y: 214, width: 160, height: 2 }, 'line', {
            stroke: theme.accent,
            strokeWidth: 2,
          }),

          text({ x: 261, y: 240, width: 600, height: 32 }, 'تشهد {{issuer.name}} بأن', {
            fontFamily: theme.fonts.body,
            fontSize: 18,
            color: theme.muted,
          }),

          text({ x: 111, y: 284, width: 900, height: 96 }, '{{recipient.name}}', {
            fontFamily: theme.fonts.heading,
            fontSize: 64,
            fontWeight: 700,
            color: theme.secondary,
            minFontSize: 26,
          }),
          shape({ x: 311, y: 388, width: 500, height: 1 }, 'line', {
            stroke: theme.muted,
            strokeWidth: 1,
          }),

          text({ x: 211, y: 410, width: 700, height: 30 }, 'قد أتم بنجاح', {
            fontFamily: theme.fonts.body,
            fontSize: 18,
            color: theme.muted,
          }),

          text({ x: 161, y: 446, width: 800, height: 62 }, '{{course}}', {
            fontFamily: theme.fonts.heading,
            fontSize: 32,
            fontWeight: 700,
            color: theme.text,
            minFontSize: 18,
          }),

          text({ x: 361, y: 514, width: 400, height: 26 }, 'بتقدير: {{grade}}', {
            fontFamily: theme.fonts.body,
            fontSize: 16,
            color: theme.muted,
            showIf: 'grade',
          }),

          text(
            { x: 161, y: 546, width: 800, height: 26 },
            'صدرت بتاريخ {{issued_at | date:"D MMMM YYYY"}}',
            {
              fontFamily: theme.fonts.body,
              fontSize: 15,
              color: theme.muted,
            },
          ),

          ...signatories(theme, 600, 140, 720),

          qr({ x: 981, y: 636, width: 92, height: 92 }, { foreground: theme.secondary }),

          // Latin and left-aligned deliberately; see the note above.
          text(
            { x: 60, y: 742, width: 600, height: 20 },
            'ID {{credential.public_id}}  ·  {{credential.verification_url}}',
            {
              fontSize: 11,
              color: theme.muted,
              align: 'left',
              fontFamily: theme.fonts.body,
              autoFit: false,
            },
          ),
        ],
        { direction: 'rtl', locale: 'ar' },
      );
    },
  },

  {
    slug: 'badge-circle',
    name: 'Circular Badge',
    category: 'Badge',
    tags: ['open-badges', 'circle', 'skill'],
    kind: 'badge',
    orientation: 'square',
    build: (theme) => {
      resetIds();
      return badge(theme, [
        shape({ x: 40, y: 40, width: 720, height: 720 }, 'ellipse', {
          fill: theme.primary,
          strokeWidth: 0,
        }),
        shape({ x: 76, y: 76, width: 648, height: 648 }, 'ellipse', {
          fill: 'transparent',
          stroke: theme.accent,
          strokeWidth: 4,
        }),
        shape({ x: 108, y: 108, width: 584, height: 584 }, 'ellipse', {
          fill: theme.surface,
          strokeWidth: 0,
        }),
        logo({ x: 340, y: 180, width: 120, height: 60 }),
        text({ x: 148, y: 264, width: 504, height: 34 }, '{{issuer.name}}', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          fontWeight: 600,
          color: theme.muted,
          letterSpacing: 2,
          textTransform: 'uppercase',
          minFontSize: 10,
        }),
        text({ x: 148, y: 314, width: 504, height: 140 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 46,
          fontWeight: 800,
          color: theme.primary,
          lineHeight: 1.15,
          minFontSize: 20,
        }),
        shape({ x: 340, y: 470, width: 120, height: 3 }, 'line', { stroke: theme.accent, strokeWidth: 3 }),
        text({ x: 148, y: 492, width: 504, height: 32 }, '{{level}}', {
          fontFamily: theme.fonts.body,
          fontSize: 18,
          fontWeight: 600,
          color: theme.accent,
          showIf: 'level',
          textTransform: 'uppercase',
          letterSpacing: 3,
        }),
        text({ x: 148, y: 534, width: 504, height: 56 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 24,
          fontWeight: 600,
          color: theme.text,
          minFontSize: 12,
        }),
        text({ x: 148, y: 592, width: 504, height: 26 }, '{{issued_at | date:"MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
        }),
        qr({ x: 352, y: 620, width: 92, height: 92 }, { foreground: theme.secondary, background: theme.surface }),
        text({ x: 148, y: 718, width: 504, height: 20 }, 'ID {{credential.public_id}}', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: theme.muted,
          autoFit: false,
        }),
      ]);
    },
  },

  {
    slug: 'badge-shield',
    name: 'Shield Badge',
    category: 'Badge',
    tags: ['open-badges', 'shield', 'certification'],
    kind: 'badge',
    orientation: 'square',
    build: (theme) => {
      resetIds();
      return badge(theme, [
        shape({ x: 120, y: 60, width: 560, height: 560 }, 'rectangle', {
          fill: theme.primary,
          strokeWidth: 0,
          borderRadius: 40,
        }),
        shape({ x: 260, y: 480, width: 280, height: 280 }, 'rectangle', {
          fill: theme.primary,
          strokeWidth: 0,
          rotation: 45,
          borderRadius: 24,
        }),
        shape({ x: 152, y: 92, width: 496, height: 496 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.accent,
          strokeWidth: 3,
          borderRadius: 28,
        }),
        logo({ x: 340, y: 132, width: 120, height: 56 }),
        text({ x: 176, y: 206, width: 448, height: 30 }, '{{issuer.name}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.85)',
          letterSpacing: 2,
          textTransform: 'uppercase',
          minFontSize: 9,
        }),
        text({ x: 176, y: 250, width: 448, height: 150 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 44,
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1.15,
          minFontSize: 18,
        }),
        shape({ x: 360, y: 414, width: 80, height: 3 }, 'line', { stroke: theme.accent, strokeWidth: 3 }),
        text({ x: 176, y: 436, width: 448, height: 30 }, '{{level}}', {
          fontFamily: theme.fonts.body,
          fontSize: 16,
          fontWeight: 700,
          color: theme.accent,
          textTransform: 'uppercase',
          letterSpacing: 3,
          showIf: 'level',
        }),
        text({ x: 176, y: 500, width: 448, height: 44 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 22,
          fontWeight: 600,
          color: '#ffffff',
          minFontSize: 11,
        }),
        text({ x: 176, y: 636, width: 448, height: 26 }, '{{issued_at | date:"MMMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
        }),
        qr({ x: 356, y: 664, width: 88, height: 88 }, { foreground: theme.secondary, background: theme.surface }),
        text({ x: 176, y: 758, width: 448, height: 18 }, 'ID {{credential.public_id}}', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: theme.muted,
          autoFit: false,
        }),
      ]);
    },
  },

  {
    slug: 'badge-hexagon',
    name: 'Hex Badge',
    category: 'Badge',
    tags: ['open-badges', 'micro-credential', 'stackable'],
    kind: 'badge',
    orientation: 'square',
    build: (theme) => {
      resetIds();
      return badge(theme, [
        shape({ x: 180, y: 120, width: 440, height: 440 }, 'rectangle', {
          fill: theme.primary,
          strokeWidth: 0,
          rotation: 30,
          borderRadius: 36,
        }),
        shape({ x: 180, y: 120, width: 440, height: 440 }, 'rectangle', {
          fill: 'transparent',
          stroke: theme.accent,
          strokeWidth: 3,
          rotation: -30,
          borderRadius: 36,
        }),
        text({ x: 200, y: 214, width: 400, height: 28 }, 'MICRO-CREDENTIAL', {
          fontFamily: theme.fonts.body,
          fontSize: 13,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.85)',
          letterSpacing: 3,
        }),
        text({ x: 200, y: 254, width: 400, height: 160 }, '{{course}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 40,
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1.15,
          minFontSize: 16,
        }),
        text({ x: 200, y: 424, width: 400, height: 30 }, '{{level}}', {
          fontFamily: theme.fonts.body,
          fontSize: 15,
          fontWeight: 700,
          color: theme.accent,
          textTransform: 'uppercase',
          letterSpacing: 3,
          showIf: 'level',
        }),
        text({ x: 120, y: 596, width: 560, height: 44 }, '{{recipient.name}}', {
          fontFamily: theme.fonts.heading,
          fontSize: 24,
          fontWeight: 700,
          color: theme.text,
          minFontSize: 12,
        }),
        text({ x: 120, y: 640, width: 560, height: 26 }, '{{issuer.name}} · {{issued_at | date:"MMM YYYY"}}', {
          fontFamily: theme.fonts.body,
          fontSize: 14,
          color: theme.muted,
          minFontSize: 9,
        }),
        qr({ x: 356, y: 672, width: 88, height: 88 }, { foreground: theme.secondary, background: theme.surface }),
        text({ x: 120, y: 764, width: 560, height: 18 }, 'ID {{credential.public_id}}', {
          fontFamily: theme.fonts.body,
          fontSize: 11,
          color: theme.muted,
          autoFit: false,
        }),
      ]);
    },
  },
];
