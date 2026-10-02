/**
 * Runtime endpoints.
 *
 * Two different base URLs on purpose. Server components run inside the cluster
 * and should reach the API over its internal address; the browser must use the
 * externally routable one. Conflating them is the classic Docker-networking
 * bug where everything works locally and nothing works in a container.
 */

/** For fetches made from a browser (client components). */
export const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ?? 'http://localhost:4000';

/** For fetches made on the server (React Server Components, route handlers). */
export const SERVER_API_URL =
  process.env.API_URL?.replace(/\/+$/, '') ?? PUBLIC_API_URL;

export const PUBLIC_URL =
  process.env.NEXT_PUBLIC_PUBLIC_URL?.replace(/\/+$/, '') ?? 'http://localhost:3000';

export const apiBase = (): string =>
  typeof window === 'undefined' ? SERVER_API_URL : PUBLIC_API_URL;

export const PRODUCT = {
  name: 'OpenCred',
  tagline: 'The open-source, standards-native credentialing platform',
  repository: 'https://github.com/opencred/opencred',
  docsPath: '/docs',
};
