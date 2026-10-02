#!/usr/bin/env node
/**
 * Runs the standalone production server.
 *
 * `next build` with `output: 'standalone'` emits a self-contained server under
 * `.next/standalone`, and `next start` refuses to serve it — it prints a
 * warning and then behaves incorrectly, most visibly by rendering error and
 * not-found routes in Next's bare fallback shell instead of inside the root
 * layout. That failure is quiet enough to pass a smoke test and still be wrong.
 *
 * Standalone deliberately excludes the static assets and `public/`, because in
 * a real deployment a CDN serves them. Locally and in CI nothing else is going
 * to, so this copies them into place first.
 *
 * The Dockerfile does the same three steps as COPY instructions; this is the
 * same assembly for anyone not building an image.
 */

import { cp, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// The standalone tree mirrors the workspace layout beneath the tracing root, so
// in this monorepo the server lands at `standalone/apps/web/server.js`.
const standaloneApp = join(appRoot, '.next', 'standalone', 'apps', 'web');
const server = join(standaloneApp, 'server.js');

try {
  await access(server);
} catch {
  process.stderr.write(
    `No standalone build found at ${server}\nRun \`npm run build -w @opencred/web\` first.\n`,
  );
  process.exit(1);
}

await cp(join(appRoot, '.next', 'static'), join(standaloneApp, '.next', 'static'), {
  recursive: true,
});
await cp(join(appRoot, 'public'), join(standaloneApp, 'public'), { recursive: true });

const port = process.env.PORT ?? '3000';
process.stdout.write(`Starting the standalone server on :${port}\n`);

const child = spawn(process.execPath, [server], {
  stdio: 'inherit',
  env: { ...process.env, PORT: port, HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0' },
});

// Forward termination so Ctrl-C and CI teardown stop the server rather than
// orphaning it.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 0));
