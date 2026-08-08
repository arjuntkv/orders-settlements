import type { ApiErrorBody } from '@orders/core';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const BASE = API_BASE;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    // only claim a json body when there is one — fastify rejects an empty
    // body sent with a json content-type
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ code: 'BAD_RESPONSE', message: 'Invalid server response' }));
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody);
  return body as T;
}
