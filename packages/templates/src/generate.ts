import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  requiredDataFields,
  templateLibraryEntrySchema,
  type TemplateLibraryEntry,
} from '@opencred/schema';
import { LAYOUTS } from './layouts';
import { THEMES } from './themes';

/**
 * Builds the starter template library.
 *
 * Output is one JSON file per template plus an index — checked into the repo,
 * reviewable in a diff, and licensed CC0 separately from the AGPL platform
 * code so that a template contribution carries no licensing friction for the
 * contributor or the issuer using it.
 *
 * Every generated template is validated against the template schema *and*
 * against the merge-field contract before it is written. A layout that
 * references a field it never declares fails this build rather than failing a
 * customer's CSV validation later.
 */

const OUT_DIR = join(__dirname, '..', 'library');

function build(): TemplateLibraryEntry[] {
  const entries: TemplateLibraryEntry[] = [];

  for (const layout of LAYOUTS) {
    for (const theme of THEMES) {
      const document = layout.build(theme);
      const entry = templateLibraryEntrySchema.parse({
        slug: `${layout.slug}-${theme.slug}`,
        name: `${layout.name} — ${theme.name}`,
        category: layout.category,
        // Theme tags stay short so the picker's filter chips fit: the slug plus
        // the leading adjective of the theme's mood line.
        tags: [
          ...layout.tags,
          theme.slug,
          theme.mood.toLowerCase().replace(/[^a-z ]/g, '').split(' ')[0],
        ],
        kind: layout.kind,
        orientation: layout.orientation,
        license: 'CC0-1.0',
        contributor: 'OpenCred',
        document,
      });

      const declared = new Set(entry.document.fields.map((f) => f.key));
      const undeclared = requiredDataFields(entry.document).filter((f) => !declared.has(f));
      if (undeclared.length > 0) {
        throw new Error(
          `template "${entry.slug}" uses undeclared merge fields: ${undeclared.join(', ')}`,
        );
      }

      const hasQr = entry.document.elements.some((el) => el.type === 'qr');
      if (!hasQr) {
        throw new Error(`template "${entry.slug}" has no QR element (FR-VER-01 requires one)`);
      }

      entries.push(entry);
    }
  }

  return entries;
}

function main(): void {
  const entries = build();

  mkdirSync(OUT_DIR, { recursive: true });
  for (const file of readdirSync(OUT_DIR)) {
    if (file.endsWith('.json')) rmSync(join(OUT_DIR, file));
  }

  for (const entry of entries) {
    writeFileSync(join(OUT_DIR, `${entry.slug}.json`), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  }

  const index = entries.map((e) => ({
    slug: e.slug,
    name: e.name,
    category: e.category,
    tags: e.tags,
    kind: e.kind,
    orientation: e.orientation,
    license: e.license,
    contributor: e.contributor,
    width: e.document.canvas.width,
    height: e.document.canvas.height,
    fields: e.document.fields.map((f) => f.key),
  }));

  writeFileSync(join(OUT_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  const byKind = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});

  process.stdout.write(
    `Generated ${entries.length} starter templates ` +
      `(${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}) ` +
      `from ${LAYOUTS.length} layouts x ${THEMES.length} themes -> ${OUT_DIR}\n`,
  );

  if (entries.length < 150) {
    throw new Error(`FR-DES-03 requires at least 150 starter templates; generated ${entries.length}`);
  }
}

if (require.main === module) main();

export { build };
