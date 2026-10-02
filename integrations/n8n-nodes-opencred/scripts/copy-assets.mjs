#!/usr/bin/env node
/**
 * Copies node icons into the build output.
 *
 * n8n resolves `icon: 'file:opencred.svg'` relative to the compiled node file,
 * and tsc does not copy non-TypeScript assets. Without this the node loads with
 * a broken image in the palette.
 */
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'nodes', 'OpenCred', 'opencred.svg');
const toDir = join(root, 'dist', 'nodes', 'OpenCred');

await mkdir(toDir, { recursive: true });
await cp(from, join(toDir, 'opencred.svg'));

process.stdout.write('copied node icons into dist\n');
