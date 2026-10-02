import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { templateLibraryEntrySchema, type TemplateLibraryEntry } from '@opencred/schema';

export { LAYOUTS, type Layout } from './layouts';
export { THEMES, themeBySlug, type Theme } from './themes';

const LIBRARY_DIR = join(__dirname, '..', 'library');

export interface TemplateLibraryIndexEntry {
  slug: string;
  name: string;
  category: string;
  tags: string[];
  kind: 'certificate' | 'badge';
  orientation: 'landscape' | 'portrait' | 'square';
  license: string;
  contributor: string;
  width: number;
  height: number;
  fields: string[];
}

let indexCache: TemplateLibraryIndexEntry[] | null = null;
const entryCache = new Map<string, TemplateLibraryEntry>();

/**
 * The library index — enough to render the picker without loading 150 full
 * documents. Individual documents are read on demand and cached, which keeps
 * a cold API start from parsing several megabytes of JSON it will not use.
 */
export function listTemplates(): TemplateLibraryIndexEntry[] {
  if (indexCache) return indexCache;
  const indexPath = join(LIBRARY_DIR, 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(
      `template library not built — run "npm run templates:build" (expected ${indexPath})`,
    );
  }
  indexCache = JSON.parse(readFileSync(indexPath, 'utf8')) as TemplateLibraryIndexEntry[];
  return indexCache;
}

export function getTemplate(slug: string): TemplateLibraryEntry {
  const cached = entryCache.get(slug);
  if (cached) return cached;

  // Slugs come from API callers; keep them from walking out of the directory.
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`invalid template slug "${slug}"`);

  const path = join(LIBRARY_DIR, `${slug}.json`);
  if (!existsSync(path)) throw new Error(`template "${slug}" not found in the starter library`);

  const entry = templateLibraryEntrySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  entryCache.set(slug, entry);
  return entry;
}

export function templateSlugs(): string[] {
  if (!existsSync(LIBRARY_DIR)) return [];
  return readdirSync(LIBRARY_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.replace(/\.json$/, ''));
}

export function searchTemplates(query: {
  q?: string;
  category?: string;
  kind?: 'certificate' | 'badge';
  orientation?: 'landscape' | 'portrait' | 'square';
}): TemplateLibraryIndexEntry[] {
  const needle = query.q?.trim().toLowerCase();
  return listTemplates().filter((entry) => {
    if (query.category && entry.category !== query.category) return false;
    if (query.kind && entry.kind !== query.kind) return false;
    if (query.orientation && entry.orientation !== query.orientation) return false;
    if (!needle) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.category.toLowerCase().includes(needle) ||
      entry.tags.some((t) => t.toLowerCase().includes(needle))
    );
  });
}

export function templateCategories(): string[] {
  return [...new Set(listTemplates().map((e) => e.category))].sort();
}
