'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ApiError } from './api';

/**
 * A minimal data-fetching hook.
 *
 * Deliberately not SWR or React Query. This application has straightforward
 * needs — fetch on mount, refetch after a mutation — and a hundred lines that
 * a reviewer can read beats a caching library whose invalidation semantics
 * they would also have to hold in their head.
 *
 * It does handle the two things a naive `useEffect(fetch)` gets wrong:
 * out-of-order responses and setting state after unmount.
 */
export function useApi<T>(
  path: string | null,
  options: { skip?: boolean } = {},
): {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (value: T | null) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path) && !options.skip);
  const [nonce, setNonce] = useState(0);

  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path || options.skip) {
      setLoading(false);
      return;
    }

    // Every request gets a sequence number; a response is only applied if it is
    // still the newest one. Without this, a slow response for page 1 can
    // overwrite a fast response for page 2.
    requestId.current += 1;
    const id = requestId.current;

    setLoading(true);
    setError(null);

    void api
      .get<T>(path)
      .then((result) => {
        if (!mounted.current || id !== requestId.current) return;
        setData(result);
      })
      .catch((err: ApiError) => {
        if (!mounted.current || id !== requestId.current) return;
        setError(err);
      })
      .finally(() => {
        if (!mounted.current || id !== requestId.current) return;
        setLoading(false);
      });
  }, [path, options.skip, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload, setData };
}

/** Wraps a mutating call with busy and error state. */
export function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult | null>;
  busy: boolean;
  error: ApiError | null;
  reset: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = useCallback(
    async (...args: TArgs) => {
      setBusy(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(err as ApiError);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  return { run, busy, error, reset: () => setError(null) };
}
