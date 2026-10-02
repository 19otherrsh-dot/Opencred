import type { FieldDefinition } from '@opencred/schema';
import type { Theme } from './themes';

/**
 * Element builders for the starter library.
 *
 * These exist so a layout file reads like a layout rather than like JSON. Each
 * returns a plain object which the generator validates against the template
 * schema before writing — so a malformed layout fails the build, not a
 * customer's issuance run.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let counter = 0;
export function resetIds(): void {
  counter = 0;
}
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}`;
}

export function text(
  rect: Rect,
  content: string,
  style: Partial<{
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    fontStyle: 'normal' | 'italic';
    color: string;
    align: 'left' | 'center' | 'right' | 'justify';
    verticalAlign: 'top' | 'middle' | 'bottom';
    letterSpacing: number;
    lineHeight: number;
    textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
    autoFit: boolean;
    minFontSize: number;
    showIf: string;
    id: string;
    rotation: number;
    opacity: number;
  }> = {},
): Record<string, unknown> {
  const { id, showIf, rotation, opacity, ...rest } = style;
  return {
    id: id ?? nextId('t'),
    type: 'text',
    ...rect,
    content,
    ...(showIf ? { showIf } : {}),
    ...(rotation ? { rotation } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...rest,
  };
}

export function shape(
  rect: Rect,
  shapeType: 'rectangle' | 'ellipse' | 'line',
  style: Partial<{
    fill: string;
    stroke: string;
    strokeWidth: number;
    strokeStyle: 'solid' | 'dashed' | 'dotted';
    borderRadius: number;
    id: string;
    rotation: number;
    opacity: number;
    brandRef: 'primary' | 'secondary' | 'accent';
  }> = {},
): Record<string, unknown> {
  const { id, rotation, opacity, ...rest } = style;
  return {
    id: id ?? nextId('s'),
    type: 'shape',
    ...rect,
    shape: shapeType,
    ...(rotation ? { rotation } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...rest,
  };
}

export function qr(
  rect: Rect,
  style: Partial<{ foreground: string; background: string; margin: number; id: string }> = {},
): Record<string, unknown> {
  const { id, ...rest } = style;
  return {
    id: id ?? nextId('q'),
    type: 'qr',
    ...rect,
    source: 'verification',
    ...rest,
  };
}

export function signature(
  rect: Rect,
  opts: {
    name: string;
    title: string;
    signatureRef?: string;
    color?: string;
    fontFamily?: string;
    fontSize?: number;
    showRule?: boolean;
    id?: string;
  },
): Record<string, unknown> {
  const { id, ...rest } = opts;
  return {
    id: id ?? nextId('sig'),
    type: 'signature',
    ...rect,
    src: '',
    ...rest,
  };
}

export function logo(rect: Rect, id?: string): Record<string, unknown> {
  return {
    id: id ?? nextId('img'),
    type: 'image',
    ...rect,
    src: '',
    brandRef: 'logo',
    fit: 'contain',
  };
}

/**
 * The merge fields a certificate template exposes by default.
 *
 * `course` is required and everything else optional with a `showIf` guard on
 * the element, so one template serves a cohort where only some rows carry a
 * grade — which is the common case and the reason issuers otherwise end up
 * maintaining near-duplicate templates.
 */
export const CERTIFICATE_FIELDS: FieldDefinition[] = [
  {
    key: 'course',
    label: 'Course or programme',
    type: 'string',
    required: true,
    example: 'Advanced Data Engineering',
  },
  { key: 'grade', label: 'Grade or result', type: 'string', required: false, example: 'Distinction' },
  { key: 'hours', label: 'Credit hours', type: 'number', required: false, example: '120' },
  {
    key: 'signatory_name',
    label: 'Signatory name',
    type: 'string',
    required: false,
    defaultValue: '',
    example: 'Dr. Amara Okafor',
  },
  {
    key: 'signatory_title',
    label: 'Signatory title',
    type: 'string',
    required: false,
    defaultValue: '',
    example: 'Programme Director',
  },
];

export const BADGE_FIELDS: FieldDefinition[] = [
  { key: 'course', label: 'Skill or programme', type: 'string', required: true, example: 'Kubernetes Operator' },
  { key: 'level', label: 'Level', type: 'string', required: false, example: 'Professional' },
];

/** The verification footer every template carries, satisfying FR-VER-01. */
export function verificationFooter(
  theme: Theme,
  opts: { width: number; y: number; x?: number; color?: string; fontSize?: number },
): Record<string, unknown> {
  return text(
    { x: opts.x ?? 0, y: opts.y, width: opts.width, height: 20 },
    'Verify at {{credential.verification_url}}  ·  ID {{credential.public_id}}',
    {
      fontSize: opts.fontSize ?? 11,
      color: opts.color ?? theme.muted,
      align: 'center',
      fontFamily: theme.fonts.body,
      autoFit: false,
    },
  );
}
