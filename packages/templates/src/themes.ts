/**
 * Themes for the starter library.
 *
 * A theme is colour plus type, nothing structural. Keeping it that way is what
 * lets fifteen layouts and ten themes produce a coherent 150-template library
 * rather than 150 unrelated one-offs — and it means a contributor adding one
 * layout gets ten finished templates out of it.
 *
 * Every palette below was picked to hold up in two places the category
 * routinely gets wrong: greyscale print (an office laser printer is where a lot
 * of certificates end up) and against the WCAG 2.1 AA contrast floor for the
 * body text, since verification pages render the same palette (§9.4).
 */

export interface Theme {
  slug: string;
  name: string;
  /** Dominant brand colour: rules, bands, seals. */
  primary: string;
  /** Deep neutral used for headings and body copy. */
  secondary: string;
  /** Sparingly used highlight: ribbons, accent rules. */
  accent: string;
  /** Page background. */
  surface: string;
  /** Body text colour. */
  text: string;
  /** De-emphasised text: labels, dates, small print. */
  muted: string;
  fonts: { heading: string; body: string; accent: string };
  mood: string;
}

export const THEMES: Theme[] = [
  {
    slug: 'oxford',
    name: 'Oxford',
    primary: '#1e3a8a',
    secondary: '#0f172a',
    accent: '#b45309',
    surface: '#ffffff',
    text: '#111827',
    muted: '#4b5563',
    fonts: { heading: 'Playfair Display', body: 'Lora', accent: 'Great Vibes' },
    mood: 'Traditional academic navy and gold.',
  },
  {
    slug: 'graphite',
    name: 'Graphite',
    primary: '#111827',
    secondary: '#1f2937',
    accent: '#6b7280',
    surface: '#ffffff',
    text: '#111827',
    muted: '#6b7280',
    fonts: { heading: 'Inter', body: 'Inter', accent: 'Inter' },
    mood: 'Monochrome, corporate, prints perfectly in greyscale.',
  },
  {
    slug: 'evergreen',
    name: 'Evergreen',
    primary: '#065f46',
    secondary: '#064e3b',
    accent: '#ca8a04',
    surface: '#ffffff',
    text: '#111827',
    muted: '#4b5563',
    fonts: { heading: 'Merriweather', body: 'Lato', accent: 'Great Vibes' },
    mood: 'Deep green and brass, for institutes and associations.',
  },
  {
    slug: 'cobalt',
    name: 'Cobalt',
    primary: '#1d4ed8',
    secondary: '#1e293b',
    accent: '#0ea5e9',
    surface: '#ffffff',
    text: '#0f172a',
    muted: '#475569',
    fonts: { heading: 'Montserrat', body: 'Open Sans', accent: 'Montserrat' },
    mood: 'Bright, modern, SaaS-ish blue.',
  },
  {
    slug: 'crimson',
    name: 'Crimson',
    primary: '#9f1239',
    secondary: '#1f2937',
    accent: '#d97706',
    surface: '#ffffff',
    text: '#111827',
    muted: '#4b5563',
    fonts: { heading: 'Playfair Display', body: 'Lora', accent: 'Great Vibes' },
    mood: 'Formal crimson, for degrees and honours.',
  },
  {
    slug: 'slate-mint',
    name: 'Slate Mint',
    primary: '#0f766e',
    secondary: '#134e4a',
    accent: '#f59e0b',
    surface: '#f8fafc',
    text: '#0f172a',
    muted: '#475569',
    fonts: { heading: 'Work Sans', body: 'Work Sans', accent: 'Work Sans' },
    mood: 'Calm teal on a soft grey page.',
  },
  {
    slug: 'violet',
    name: 'Violet',
    primary: '#6d28d9',
    secondary: '#312e81',
    accent: '#db2777',
    surface: '#ffffff',
    text: '#1e1b4b',
    muted: '#4c1d95',
    fonts: { heading: 'Poppins', body: 'Open Sans', accent: 'Poppins' },
    mood: 'Confident violet, popular with bootcamps and creators.',
  },
  {
    slug: 'sandstone',
    name: 'Sandstone',
    primary: '#92400e',
    secondary: '#451a03',
    accent: '#0f766e',
    surface: '#fffbeb',
    text: '#1c1917',
    muted: '#57534e',
    fonts: { heading: 'EB Garamond', body: 'EB Garamond', accent: 'Great Vibes' },
    mood: 'Warm parchment, for heritage and arts programmes.',
  },
  {
    slug: 'midnight',
    name: 'Midnight',
    primary: '#38bdf8',
    secondary: '#e2e8f0',
    accent: '#f472b6',
    surface: '#0b1220',
    text: '#e2e8f0',
    muted: '#94a3b8',
    fonts: { heading: 'Montserrat', body: 'Inter', accent: 'JetBrains Mono' },
    mood: 'Dark canvas for technical and developer credentials.',
  },
  {
    slug: 'ocean',
    name: 'Ocean',
    primary: '#0369a1',
    secondary: '#082f49',
    accent: '#14b8a6',
    surface: '#ffffff',
    text: '#0f172a',
    muted: '#475569',
    fonts: { heading: 'Raleway', body: 'Open Sans', accent: 'Raleway' },
    mood: 'Fresh blue-teal, general purpose.',
  },
];

export function themeBySlug(slug: string): Theme {
  const found = THEMES.find((t) => t.slug === slug);
  if (!found) throw new Error(`unknown theme "${slug}"`);
  return found;
}
