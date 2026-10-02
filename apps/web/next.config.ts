import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// `new URL(...).pathname` would percent-encode the path, which breaks on any
// checkout whose directory contains a space. `fileURLToPath` decodes properly.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * OpenCred web application.
 *
 * Three audiences share one Next.js app, and the configuration reflects that:
 *
 *  - **Public verification pages** (`/v/:id`) are server-rendered and briefly
 *    cacheable. They are the surface an employer scans a QR code into, so they
 *    must be fast on a bad phone connection and correct about revocation.
 *  - **The admin dashboard** is client-rendered against the API with a session
 *    token, because it is a logged-in application, not a document.
 *  - **The recipient wallet** is an installable PWA.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The shared packages are workspace TypeScript builds; Next has to transpile
  // them rather than treat them as prebuilt external CommonJS.
  transpilePackages: ['@opencred/schema', '@opencred/renderer', '@opencred/i18n'],

  // Produces a self-contained server bundle for the Docker image, so the
  // runtime container does not need the workspace or node_modules.
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,

  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'permissions-policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
        ],
      },
      {
        source: '/v/:path*',
        headers: [
          // Verification pages must never be framed: a credential shown inside
          // someone else's chrome is a phishing surface.
          { key: 'x-frame-options', value: 'DENY' },
          // Short cache with revalidation. Revocation has to propagate quickly,
          // but a QR code scanned by fifty people should not be fifty renders.
          { key: 'cache-control', value: 'public, max-age=60, stale-while-revalidate=300' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'cache-control', value: 'public, max-age=3600' }],
      },
    ];
  },
};

export default nextConfig;
