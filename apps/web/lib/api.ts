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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// free-tier hosting sleeps after idle; while the API boots, the platform
// answers 502/503 with an html page instead of our json. Those responses
// never reached the API, so retrying is safe, including for POSTs.
const WAKING_STATUSES = new Set([502, 503, 504]);
const WAKE_RETRIES = 7;
const WAKE_DELAY_MS = 5000;

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = null;
    }

    // non-json body = the platform edge answered, not our API (which always
    // returns json). Retry those; real API errors pass through untouched.
    if (body === null) {
      if (attempt < WAKE_RETRIES && (WAKING_STATUSES.has(res.status) || !res.ok)) {
        await sleep(WAKE_DELAY_MS);
        continue;
      }
      throw new ApiError(res.status, {
        code: 'SERVER_WAKING',
        message:
          'The server is waking up after being idle (free hosting). Give it about 30 seconds and try again.',
      });
    }

    if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody);
    return body as T;
  }
}

// fire-and-forget: starts the API booting while the visitor is still typing
export function warmUpApi(): void {
  void fetch(`${BASE}/health`, { credentials: 'include' }).catch(() => {});
}
