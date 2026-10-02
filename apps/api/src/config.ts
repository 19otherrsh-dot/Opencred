import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Edition } from '@opencred/schema';

/**
 * Load a `.env` file, if one is present.
 *
 * Implemented here rather than pulled from `dotenv` for the same reason the
 * rest of this codebase avoids incidental dependencies: it is twenty lines,
 * and a self-hosted operator reading the config loader should be able to see
 * exactly where their secrets come from.
 *
 * Precedence is deliberate: a real environment variable always wins over the
 * file. Otherwise a stale `.env` left in a container image would silently
 * override the secrets the orchestrator injected.
 */
function loadDotEnv(): void {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
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
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * Configuration is parsed once, at boot, against a schema.
 *
 * A credentialing platform that starts up with a half-configured signing key or
 * an empty JWT secret and only discovers it under load is worse than one that
 * refuses to start. Everything below either has a safe default or is rejected
 * loudly — with one deliberate exception noted at `assertProductionSafety`.
 */

const bool = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : v === 'true' || v === '1'));

const int = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : Number(v)))
    .pipe(z.number().int());

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OPENCRED_EDITION: z.enum(['cloud', 'community', 'enterprise']).default('community'),
  OPENCRED_ROLE: z.enum(['api', 'worker', 'all']).default('all'),

  PORT: int(4000),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1),
  VALKEY_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().min(16),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./var/storage'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('opencred'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool(true),

  MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('log'),
  MAIL_HOST: z.string().default('localhost'),
  MAIL_PORT: int(1025),
  MAIL_SECURE: bool(false),
  MAIL_USER: z.string().default(''),
  MAIL_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().default('OpenCred <no-reply@localhost>'),

  RENDER_CONCURRENCY: int(4),
  RENDER_TIMEOUT_MS: int(30_000),
  ISSUANCE_CONCURRENCY: int(8),
  WEBHOOK_CONCURRENCY: int(16),

  OAUTH_GOOGLE_CLIENT_ID: z.string().default(''),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().default(''),
  OAUTH_MICROSOFT_CLIENT_ID: z.string().default(''),
  OAUTH_MICROSOFT_CLIENT_SECRET: z.string().default(''),
  OAUTH_MICROSOFT_TENANT: z.string().default('common'),

  // FR-STD-04 — Apple and Google Wallet passes. Both are instance-level: the
  // certificates and issuer accounts belong to whoever runs the deployment, not
  // to individual workspaces, and each workspace's identity travels inside the
  // pass content. Blank means the feature is simply off, which is the correct
  // state for a self-hosted install that has not enrolled with Apple or Google.
  WALLET_GOOGLE_ISSUER_ID: z.string().default(''),
  WALLET_GOOGLE_CLASS_SUFFIX: z.string().default('opencred_credential'),
  WALLET_GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().default(''),
  // PEM. `\n` escapes are accepted because that is how the key survives being
  // pasted out of a Google service-account JSON file into an environment.
  WALLET_GOOGLE_PRIVATE_KEY: z.string().default(''),

  WALLET_APPLE_PASS_TYPE_ID: z.string().default(''),
  WALLET_APPLE_TEAM_ID: z.string().default(''),
  WALLET_APPLE_CERT_PATH: z.string().default(''),
  WALLET_APPLE_KEY_PATH: z.string().default(''),
  WALLET_APPLE_KEY_PASSPHRASE: z.string().default(''),
  WALLET_APPLE_WWDR_PATH: z.string().default(''),
  WALLET_APPLE_OPENSSL_PATH: z.string().default(''),

  TELEMETRY_ENABLED: bool(false),
  TELEMETRY_ENDPOINT: z.string().default(''),

  BILLING_DRIVER: z.enum(['internal', 'stripe']).default('internal'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
});

export type AppConfig = z.infer<typeof configSchema> & {
  edition: Edition;
  isProduction: boolean;
  isSelfHosted: boolean;
};

const INSECURE_DEFAULTS = [
  'dev-only-insecure-jwt-secret-change-me-0000000000',
  'dev-only-insecure-encryption-key-change-me-000000',
];

let cached: AppConfig | null = null;

export function loadConfig(env?: NodeJS.ProcessEnv): AppConfig {
  if (cached) return cached;

  if (!env) loadDotEnv();
  const parsed = configSchema.safeParse(env ?? process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}\n\nSee .env.example for the full list.`);
  }

  const value = parsed.data;
  const config: AppConfig = {
    ...value,
    edition: value.OPENCRED_EDITION,
    isProduction: value.NODE_ENV === 'production',
    isSelfHosted: value.OPENCRED_EDITION !== 'cloud',
  };

  assertProductionSafety(config);
  cached = config;
  return config;
}

/**
 * Refuse to boot a production instance carrying the development secrets.
 *
 * The shipped `.env.example` has working defaults so a first run needs no
 * edits — which is exactly why this check exists. "It worked on my laptop and
 * I deployed the same file" is how a signing key ends up public.
 */
function assertProductionSafety(config: AppConfig): void {
  if (!config.isProduction) return;

  const problems: string[] = [];
  if (INSECURE_DEFAULTS.includes(config.JWT_SECRET)) {
    problems.push('JWT_SECRET is still the development placeholder');
  }
  if (INSECURE_DEFAULTS.includes(config.ENCRYPTION_KEY)) {
    problems.push('ENCRYPTION_KEY is still the development placeholder');
  }
  if (config.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (config.ENCRYPTION_KEY.length < 32) {
    problems.push('ENCRYPTION_KEY must be at least 32 characters');
  }
  if (!config.PUBLIC_URL.startsWith('https://')) {
    problems.push(
      'PUBLIC_URL must be https in production — it is embedded in every credential and DID document',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with an unsafe configuration:\n${problems
        .map((p) => `  - ${p}`)
        .join('\n')}\n\nGenerate secrets with: openssl rand -base64 48`,
    );
  }
}

/** Test helper: forget the memoised config. */
export function resetConfig(): void {
  cached = null;
}
