/**
 * Loads the repository `.env` for standalone scripts.
 *
 * The API loads its own `.env` internally; scripts that talk to the database
 * directly (rather than through the API) need the same values and would
 * otherwise fail with an unhelpful "Environment variable not found".
 *
 * Real environment variables always win, so this cannot override what an
 * operator injected.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const path = resolve(root, '.env');
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnv();
