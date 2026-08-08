'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from './api';

// tiny data hook: no cache layer needed at this scale, but 401s always
// bounce to login so every page gets the auth guard for free
export function useApi<T>(path: string | null) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // clear a stale/invalid cookie so the middleware gate agrees with
        // the API about who is logged in; ignore failures
        void api('/auth/logout', { method: 'POST' }).catch(() => {});
        router.push('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [path, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
