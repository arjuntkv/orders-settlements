'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // even if the server call fails, leaving the app is the right outcome
    }
    router.push('/login');
  }

  return (
    <div className="mx-auto max-w-5xl px-4">
      <header className="flex items-center justify-between border-b border-slate-200 py-4">
        <Link href="/orders" className="font-semibold">
          Orders &amp; Settlements
        </Link>
        <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-900">
          Log out
        </button>
      </header>
      <main className="py-6">{children}</main>
    </div>
  );
}
