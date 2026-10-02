'use client';

import { PUBLIC_API_URL } from './config';

/**
 * The browser-side API client.
 *
 * Design decisions worth stating, because they are security decisions:
 *
 *  - The access token lives in a module-scoped variable, never in
 *    `localStorage`. A token in web storage is readable by any script that
 *    manages to run on the page; a token in a closure is not, and the refresh
 *    cookie that regenerates it is `httpOnly`.
 *  - A 401 triggers exactly one refresh attempt, and concurrent requests share
 *    that single attempt. Without the sharing, a dashboard that fires six
 *    requests on mount performs six token rotations and five of them lose the
 *    race, logging the user out.
 */

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the automatic refresh-and-retry, used by the refresh call itself. */
  noRetry?: boolean;
  /** Return the raw Response rather than parsed JSON (downloads, CSV). */
  raw?: boolean;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${PUBLIC_API_URL}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          credentials: 'include',
        });
        if (!response.ok) return false;
        const session = (await response.json()) as { accessToken?: string };
        if (!session.accessToken) return false;
        accessToken = session.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        // Cleared on the next tick so callers awaiting this promise all see the
        // same result before a new attempt can begin.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, noRetry, raw, headers, ...rest } = options;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const send = async (): Promise<Response> =>
    fetch(`${PUBLIC_API_URL}${path}`, {
      ...rest,
      headers: {
        ...(isFormData ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(headers as Record<string, string>),
      },
      credentials: 'include',
      body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });

  let response = await send();

  if (response.status === 401 && !noRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await send();
    } else {
      accessToken = null;
      onUnauthenticated?.();
    }
  }

  if (raw) {
    if (!response.ok) throw await toApiError(response);
    return response as unknown as T;
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) throw await toApiError(response);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return (await response.json()) as T;
  return (await response.text()) as unknown as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(
    response.status,
    (payload.error as string) ?? 'request_failed',
    (payload.message as string) ?? `Request failed with status ${response.status}`,
    payload.details ?? payload,
    (payload.requestId as string) ?? response.headers.get('x-request-id') ?? undefined,
  );
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  raw: (path: string, options?: RequestOptions) =>
    request<Response>(path, { ...options, raw: true }),
  refreshSession,
};

/** Download a file through the authenticated API and hand it to the browser. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await api.raw(path);
  const blob = await response.blob();

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? fallbackName;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick so the click has definitely been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
