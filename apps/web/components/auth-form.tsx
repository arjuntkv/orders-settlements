'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, warmUpApi } from '@/lib/api';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  // wake the API while the visitor is still typing their credentials
  useEffect(() => warmUpApi(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      router.push('/orders');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error, try again');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-semibold">{mode === 'login' ? 'Log in' : 'Create account'}</h1>
      <p className="mb-6 text-sm text-slate-500">Orders &amp; Settlements</p>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </label>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? 'Working…' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-500">
        {mode === 'login' ? (
          <>
            No account? <Link className="underline" href="/signup">Sign up</Link>
          </>
        ) : (
          <>
            Have an account? <Link className="underline" href="/login">Log in</Link>
          </>
        )}
      </p>
    </main>
  );
}
