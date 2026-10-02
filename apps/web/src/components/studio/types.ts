import type { TemplateDocument, TemplateElement } from '@opencred/schema';

export type { TemplateDocument, TemplateElement };

export type ElementType = TemplateElement['type'];

export const ELEMENT_LABELS: Record<ElementType, string> = {
  text: 'Text',
  image: 'Image',
  shape: 'Shape',
  qr: 'QR code',
  signature: 'Signature',
};

/**
 * The merge tokens the editor offers for insertion.
 *
 * Only the system fields are listed here; a template's own declared fields are
 * added at runtime from the document, so the picker always matches what the
 * template actually accepts.
 */
export const SYSTEM_TOKENS: Array<{ token: string; label: string }> = [
  { token: 'recipient.name', label: 'Recipient name' },
  { token: 'recipient.first_name', label: 'Recipient first name' },
  { token: 'recipient.last_name', label: 'Recipient last name' },
  { token: 'recipient.email', label: 'Recipient email' },
  { token: 'recipient.external_id', label: 'Recipient external ID' },
  { token: 'credential.title', label: 'Credential title' },
  { token: 'credential.public_id', label: 'Credential ID' },
  { token: 'credential.verification_url', label: 'Verification URL' },
  { token: 'issuer.name', label: 'Issuer name' },
  { token: 'issuer.url', label: 'Issuer website' },
  { token: 'issued_at', label: 'Issue date' },
  { token: 'expires_at', label: 'Expiry date' },
  { token: 'batch.name', label: 'Batch name' },
];

export const FONT_CHOICES = [
  'Inter',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Raleway',
  'Work Sans',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'Libre Baskerville',
  'EB Garamond',
  'Cormorant Garamond',
  'Great Vibes',
  'Dancing Script',
  'JetBrains Mono',
];

/** A new element of the requested type, positioned near the canvas centre. */
export function createElement(
  type: ElementType,
  canvas: { width: number; height: number },
  id: string,
): TemplateElement {
  const base = {
    id,
    x: Math.round(canvas.width / 2 - 150),
    y: Math.round(canvas.height / 2 - 30),
    width: 300,
    height: 60,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
  };

  switch (type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        content: 'New text',
        fontFamily: 'Inter',
        fontSize: 28,
        fontWeight: 400,
        fontStyle: 'normal',
        color: '#111827',
        align: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.3,
        letterSpacing: 0,
        textTransform: 'none',
        textDecoration: 'none',
        autoFit: true,
        minFontSize: 10,
      };
    case 'image':
      return {
        ...base,
        type: 'image',
        width: 200,
        height: 120,
        src: '',
        fit: 'contain',
        borderRadius: 0,
      };
    case 'shape':
      return {
        ...base,
        type: 'shape',
        width: 240,
        height: 4,
        shape: 'line',
        fill: 'transparent',
        stroke: '#111827',
        strokeWidth: 2,
        strokeStyle: 'solid',
        borderRadius: 0,
      };
    case 'qr':
      return {
        ...base,
        type: 'qr',
        width: 110,
        height: 110,
        source: 'verification',
        foreground: '#111827',
        background: '#ffffff',
        margin: 1,
        errorCorrection: 'M',
      };
    case 'signature':
      return {
        ...base,
        type: 'signature',
        width: 260,
        height: 92,
        src: '',
        name: '{{signatory_name}}',
        title: '{{signatory_title}}',
        showRule: true,
        color: '#111827',
        fontFamily: 'Inter',
        fontSize: 13,
      };
    default:
      throw new Error(`unknown element type ${type}`);
  }
}
