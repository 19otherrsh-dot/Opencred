#!/usr/bin/env node
/**
 * Issuance load benchmark (FR-ISS-01).
 *
 * The requirement is 10,000 credentials in under five minutes, "load-tested and
 * published as a benchmark". This is that test. It issues a real batch through
 * the real API, then polls until every credential is signed, rendered and
 * stored, and reports throughput.
 *
 *   node scripts/benchmark-issuance.mjs --count 10000 [--api http://localhost:4000]
 *
 * Two honesty notes, because a benchmark that flatters itself is worthless:
 *
 *  - The clock starts when the batch is confirmed and stops when the last
 *    credential leaves `draft`. Accepting the upload quickly is not the claim;
 *    finishing the work is.
 *  - Email delivery is suppressed. Throughput would otherwise measure the SMTP
 *    provider's rate limit rather than this platform.
 */

import { setTimeout as sleep } from 'node:timers/promises';

const API = argValue('--api') ?? process.env.API_URL ?? 'http://localhost:4000';
const COUNT = Number(argValue('--count') ?? 10_000);
const EMAIL_DOMAIN = 'benchmark.invalid';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

let token = null;

async function call(path, { method = 'GET', body, formData } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(formData ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed;
}

function fmt(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function bar(fraction, width = 32) {
  const filled = Math.round(fraction * width);
  return `[${'█'.repeat(filled)}${'·'.repeat(width - filled)}]`;
}

async function main() {
  process.stdout.write(`OpenCred issuance benchmark\n`);
  process.stdout.write(`  target: ${API}\n  volume: ${COUNT.toLocaleString()} credentials\n\n`);

  // --- Set-up: a throwaway workspace so the benchmark never touches real data.
  const stamp = Date.now();
  const session = await call('/v1/auth/register', {
    method: 'POST',
    body: {
      organizationName: `Benchmark ${stamp}`,
      name: 'Benchmark Runner',
      email: `benchmark-${stamp}@${EMAIL_DOMAIN}`,
      password: 'benchmark-password-long-enough',
    },
  });
  token = session.accessToken;

  const templates = await call('/v1/templates');
  const template = templates.find((t) => t.kind === 'certificate') ?? templates[0];
  if (!template) throw new Error('the new workspace has no templates to issue from');

  process.stdout.write(`  template: ${template.name}\n`);

  const instance = await call('/v1/instance');
  process.stdout.write(`  renderer: ${instance.capabilities.rendering}\n`);
  if (instance.capabilities.rendering !== 'chromium') {
    process.stdout.write(
      `  \x1b[33mnote\x1b[0m Chromium is unavailable, so this measures SVG output, not PDF.\n`,
    );
  }
  process.stdout.write('\n');

  // --- Upload -----------------------------------------------------------------
  const rows = ['Full Name,Email Address,Course,Grade'];
  for (let i = 0; i < COUNT; i += 1) {
    rows.push(`Benchmark Recipient ${i},recipient${i}-${stamp}@${EMAIL_DOMAIN},Load Testing,Pass`);
  }
  const csv = rows.join('\n');

  const uploadStarted = Date.now();
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'benchmark.csv');
  form.set('templateId', template.id);
  form.set('name', `Benchmark ${stamp}`);

  const upload = await call('/v1/batches/upload', { method: 'POST', formData: form });
  process.stdout.write(`upload      ${fmt((Date.now() - uploadStarted) / 1000)}\n`);

  const validateStarted = Date.now();
  const validation = await call(`/v1/batches/${upload.batchId}/validate`, {
    method: 'POST',
    body: { mapping: upload.suggestedMapping, defaults: {} },
  });
  process.stdout.write(
    `validate    ${fmt((Date.now() - validateStarted) / 1000)} (${validation.validRows.toLocaleString()} valid rows)\n`,
  );

  // --- The measured window ----------------------------------------------------
  const started = Date.now();
  const issued = await call(`/v1/batches/${upload.batchId}/issue`, {
    method: 'POST',
    body: { skipInvalidRows: true, suppressEmail: true },
  });
  const accepted = (Date.now() - started) / 1000;
  process.stdout.write(`accept      ${fmt(accepted)} (${issued.queued.toLocaleString()} queued)\n\n`);

  let processed = 0;
  let lastProcessed = 0;
  let stalledPolls = 0;

  while (processed < issued.queued) {
    await sleep(2000);

    const batch = await call(`/v1/batches/${upload.batchId}`);
    processed = batch.processedCount;

    const elapsed = (Date.now() - started) / 1000;
    const rate = processed / Math.max(elapsed, 0.001);
    const remaining = rate > 0 ? (issued.queued - processed) / rate : Infinity;

    process.stdout.write(
      `\r${bar(processed / issued.queued)} ${processed.toLocaleString()}/${issued.queued.toLocaleString()}  ` +
        `${rate.toFixed(0)}/s  elapsed ${fmt(elapsed)}  eta ${Number.isFinite(remaining) ? fmt(remaining) : '—'}   `,
    );

    // Detect a stalled run rather than hanging forever: if nothing has moved
    // for two minutes, the workers are almost certainly not running.
    if (processed === lastProcessed) {
      stalledPolls += 1;
      if (stalledPolls > 60) {
        process.stdout.write('\n\nStalled. Is the worker process running (`npm run dev:worker`)?\n');
        process.exit(1);
      }
    } else {
      stalledPolls = 0;
      lastProcessed = processed;
    }
  }

  const total = (Date.now() - started) / 1000;

  process.stdout.write('\n\n');
  process.stdout.write('─'.repeat(56) + '\n');
  process.stdout.write(`  credentials      ${issued.queued.toLocaleString()}\n`);
  process.stdout.write(`  wall clock       ${fmt(total)}\n`);
  process.stdout.write(`  throughput       ${(issued.queued / total).toFixed(1)} credentials/second\n`);
  process.stdout.write(`  per credential   ${((total / issued.queued) * 1000).toFixed(1)} ms\n`);
  process.stdout.write(`  api accept time  ${fmt(accepted)}\n`);
  process.stdout.write('─'.repeat(56) + '\n');

  // The FR-ISS-01 target, scaled to whatever volume was actually run.
  const budget = (COUNT / 10_000) * 300;
  if (total <= budget) {
    process.stdout.write(
      `\n\x1b[32mPASS\x1b[0m  ${fmt(total)} is within the ${fmt(budget)} budget ` +
        `(FR-ISS-01: 10,000 in under 5 minutes).\n`,
    );
  } else {
    process.stdout.write(
      `\n\x1b[31mFAIL\x1b[0m  ${fmt(total)} exceeds the ${fmt(budget)} budget.\n` +
        `      Scale the workers, or raise ISSUANCE_CONCURRENCY and RENDER_CONCURRENCY.\n`,
    );
  }

  process.stdout.write(
    `\nRendering is the bottleneck and it scales horizontally: throughput is\n` +
      `roughly linear in worker replicas until the database becomes the limit.\n`,
  );

  process.exit(total <= budget ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`\nbenchmark failed: ${err?.stack ?? err}\n`);
  process.exit(2);
});
