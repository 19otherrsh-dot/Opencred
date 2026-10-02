import type { TemplateDocument } from '@opencred/schema';

/**
 * Font handling for the render pipeline.
 *
 * Constraint that drives the whole design here: a Community Edition install
 * must produce a byte-identical PDF with no outbound network access
 * (FR-ID-04). So nothing links a font CDN. Instead:
 *
 *  1. Templates may carry `@font-face` sources, which self-hosters point at
 *     their own asset storage.
 *  2. Anything else resolves through a curated stack of open-licensed families
 *     with generic fallbacks, so a missing font degrades to a sane serif or
 *     sans rather than to Times New Roman on one machine and something else on
 *     the next.
 *
 * Deterministic output matters more than typographic ambition: a reissued
 * credential that does not look like the original is a support ticket.
 */

const GENERIC_STACKS: Record<string, string> = {
  // Sans
  Inter: `'Inter', 'Noto Sans', 'DejaVu Sans', 'Segoe UI', Roboto, Arial, sans-serif`,
  'Open Sans': `'Open Sans', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif`,
  Lato: `'Lato', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif`,
  Montserrat: `'Montserrat', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif`,
  Poppins: `'Poppins', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif`,
  Raleway: `'Raleway', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif`,
  'Work Sans': `'Work Sans', 'Noto Sans', 'DejaVu Sans', Arial, sans-serif`,
  // Serif
  'Playfair Display': `'Playfair Display', 'Noto Serif', 'DejaVu Serif', Georgia, serif`,
  Merriweather: `'Merriweather', 'Noto Serif', 'DejaVu Serif', Georgia, serif`,
  Lora: `'Lora', 'Noto Serif', 'DejaVu Serif', Georgia, serif`,
  'Libre Baskerville': `'Libre Baskerville', 'Noto Serif', 'DejaVu Serif', Georgia, serif`,
  'EB Garamond': `'EB Garamond', 'Noto Serif', 'DejaVu Serif', Garamond, Georgia, serif`,
  'Cormorant Garamond': `'Cormorant Garamond', 'EB Garamond', 'Noto Serif', Georgia, serif`,
  // Script, for signature lines
  'Great Vibes': `'Great Vibes', 'Brush Script MT', cursive`,
  'Dancing Script': `'Dancing Script', 'Brush Script MT', cursive`,
  // Mono
  'JetBrains Mono': `'JetBrains Mono', 'Noto Sans Mono', 'DejaVu Sans Mono', Consolas, monospace`,
};

/**
 * Families with broad script coverage, appended to every stack so that a
 * Hindi, Arabic or CJK name in a merge field renders as glyphs rather than as
 * tofu boxes. Localisation (§9.4) is not only an interface concern — recipient
 * names arrive in every script there is.
 */
const SCRIPT_FALLBACKS = `'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Arabic', 'Noto Sans CJK SC', 'Noto Sans Hebrew', 'Noto Color Emoji'`;

export function fontStack(family: string): string {
  const known = GENERIC_STACKS[family];
  if (known) return `${known}, ${SCRIPT_FALLBACKS}`;
  // Unknown families are still honoured — the family may be installed on a
  // self-hosted render node — but always with the fallback chain behind them.
  return `'${family.replace(/['\\]/g, '')}', ${SCRIPT_FALLBACKS}, sans-serif`;
}

export const AVAILABLE_FONTS = Object.keys(GENERIC_STACKS);

/** `@font-face` blocks for the self-hosted font files a template declares. */
export function fontFaceCss(doc: TemplateDocument): string {
  return doc.fonts
    .filter((f) => Boolean(f.src))
    .map((f) => {
      const format = f.src!.endsWith('.woff2')
        ? 'woff2'
        : f.src!.endsWith('.woff')
          ? 'woff'
          : f.src!.endsWith('.otf')
            ? 'opentype'
            : 'truetype';
      return `@font-face{font-family:'${f.family.replace(/['\\]/g, '')}';src:url('${f.src}') format('${format}');font-weight:${f.weight};font-style:${f.style};font-display:block;}`;
    })
    .join('\n');
}
