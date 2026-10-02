#!/usr/bin/env node
/**
 * First-run bootstrap.
 *
 * Takes a fresh clone to a running system: checks prerequisites, writes a `.env`
 * with real secrets, starts the infrastructure containers, applies the schema,
 * builds, and installs Chromium.
 *
 *   node scripts/bootstrap.mjs [--skip-docker] [--skip-browser]
 *
 * Every step prints what it is about to do and why, because a bootstrap script
 * that silently does fifteen things to your machine is one nobody should run.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const skipDocker = process.argv.includes('--skip-docker');
const skipBrowser = process.argv.includes('--skip-browser');

const log = (message) => process.stdout.write(`${message}\n`);
const step = (message) => log(`\n\x1b[1m${message}\x1b[0m`);
const ok = (message) => log(`  \x1b[32mok\x1b[0m   ${message}`);
const warn = (message) => log(`  \x1b[33mwarn\x1b[0m ${message}`);
const fail = (message) => log(`  \x1b[31mfail\x1b[0m ${message}`);

function run(command, options = {}) {
  return spawnSync(command, {
    shell: true,
    stdio: options.quiet ? 'pipe' : 'inherit',
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
}

function capture(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// --- 1. Prerequisites --------------------------------------------------------
step('Checking prerequisites');

const nodeVersion = process.versions.node;
const [major] = nodeVersion.split('.').map(Number);
if (major < 20) {
  fail(`Node ${nodeVersion} — OpenCred needs Node 20.11 or later.`);
  process.exit(1);
}
ok(`Node ${nodeVersion}`);

const docker = capture('docker --version');
if (docker) ok(docker);
else if (!skipDocker) {
  warn('Docker not found. Start PostgreSQL and Valkey yourself, then re-run with --skip-docker.');
}

// --- 2. Environment ----------------------------------------------------------
step('Configuring the environment');

const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  ok('.env already exists, leaving it alone');
} else {
  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');

  // Real secrets, not the placeholders. The API refuses to boot in production
  // with the shipped defaults, and a development instance signing credentials
  // with a publicly known key is not a habit worth forming either.
  const env = example
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(48).toString('base64')}`)
    .replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${randomBytes(48).toString('base64')}`);

  writeFileSync(envPath, env, 'utf8');
  ok('wrote .env with freshly generated secrets');
  warn('ENCRYPTION_KEY decrypts issuer signing keys. Back it up before you issue anything real.');
}

// --- 3. Dependencies ---------------------------------------------------------
step('Installing dependencies');
if (run('npm install --no-audit --no-fund').status !== 0) {
  fail('npm install failed');
  process.exit(1);
}
ok('dependencies installed');

// --- 4. Infrastructure -------------------------------------------------------
if (!skipDocker && docker) {
  step('Starting PostgreSQL, Valkey and a local mail catcher');
  const result = run('docker compose up -d postgres valkey mailpit');
  if (result.status !== 0) {
    fail('docker compose failed. If a port is already taken, set POSTGRES_PORT / VALKEY_PORT in .env.');
    process.exit(1);
  }
  ok('containers running');

  // Postgres accepts TCP connections a moment before it is ready for queries.
  log('  waiting for PostgreSQL to accept queries…');
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = run('docker compose exec -T postgres pg_isready -U opencred -d opencred', {
      quiet: true,
    });
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) {
    fail('PostgreSQL did not become ready in 30 seconds');
    process.exit(1);
  }
  ok('PostgreSQL ready');
}

// --- 5. Build ----------------------------------------------------------------
step('Building the shared packages');
for (const pkg of ['@opencred/schema', '@opencred/credentials', '@opencred/renderer', '@opencred/templates']) {
  if (run(`npm run build -w ${pkg}`, { quiet: true }).status !== 0) {
    fail(`failed to build ${pkg}`);
    process.exit(1);
  }
  ok(pkg);
}

step('Generating the database client');
if (run('npx prisma generate --schema apps/api/prisma/schema.prisma', { quiet: true }).status !== 0) {
  fail('prisma generate failed');
  process.exit(1);
}
ok('Prisma client generated');

step('Applying the database schema');
// `migrate deploy`, not `db push`: it is what production runs, so a fresh
// developer install exercises the same path a Helm upgrade will. `db push` is
// still available as `npm run db:push` for iterating on the schema itself.
if (run('npx prisma migrate deploy --schema apps/api/prisma/schema.prisma').status !== 0) {
  fail('migrations failed — check DATABASE_URL in .env');
  process.exit(1);
}
ok('migrations applied');

step('Building the API');
if (run('npx tsc -p apps/api/tsconfig.json').status !== 0) {
  fail('API build failed');
  process.exit(1);
}
ok('API built');

// --- 6. Chromium -------------------------------------------------------------
if (!skipBrowser) {
  step('Installing Chromium for credential rendering');
  log('  ~150 MB. Without it credentials render as SVG instead of PDF.');
  if (run('npx playwright install chromium').status !== 0) {
    warn('Chromium install failed — issuance still works, but output will be SVG.');
  } else {
    ok('Chromium installed');
  }
}

// --- 7. Seed -----------------------------------------------------------------
step('Seeding a demo workspace');
if (run('node apps/api/dist/seed.js', { quiet: true }).status !== 0) {
  warn('seed failed — the platform still works, it is just empty');
} else {
  ok('demo workspace created');
}

// --- Done --------------------------------------------------------------------
log(`
\x1b[1mReady.\x1b[0m Start the three processes in separate terminals:

  npm run dev:api      # http://localhost:4000
  npm run dev:worker   # signs and renders credentials
  npm run dev:web      # http://localhost:3000

Then sign in at http://localhost:3000/login

  demo@opencred.local / opencred-demo-password

Other things worth knowing:

  API reference     http://localhost:4000/docs
  Captured emails   http://localhost:8025
  End-to-end check  node scripts/smoke-test.mjs
  Issuance load     node scripts/benchmark-issuance.mjs
`);
