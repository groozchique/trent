'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import type { SessionUser } from '@/lib/auth/session';
import { ThemeToggle } from './ThemeToggle';

const ROLE_LABELS: Record<SessionUser['role'], string> = {
  admin: 'Администратор',
  viewer: 'Просмотр',
};

/** Persistent top navigation bar with user badge, logout action, and theme toggle. */
export function TopBar({ user }: { user: SessionUser | null }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout() {
    if (loggingOut) return;
    setLogoutError(null);
    setLoggingOut(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (response.ok) {
        router.push('/login');
        router.refresh();
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setLogoutError(data?.error ?? 'Не удалось выйти. Попробуйте ещё раз');
      setLoggingOut(false);
    } catch {
      setLogoutError('Не удалось выйти. Проверьте сеть');
      setLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
        <Link
          href={user ? '/' : '/login'}
          className="flex min-w-0 items-center gap-2 rounded-md py-1 text-[var(--text-primary)] transition-opacity hover:opacity-80 sm:gap-2.5"
        >
          <span
            aria-hidden="true"
            className="grid h-6 w-6 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded border border-[var(--border-strong)] bg-[var(--status-overdue)] p-1"
          >
            <span className="bg-[#18191B]" />
            <span />
            <span />
            <span className="bg-[#18191B]" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight sm:text-base">
            tRent
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {user && (
            <>
              <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs sm:px-2.5">
                <span className="max-w-[68px] truncate font-medium text-[var(--text-primary)] sm:max-w-[160px]">
                  {user.username}
                </span>
                <span className="hidden rounded bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] sm:inline">
                  {ROLE_LABELS[user.role]}
                </span>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:text-sm"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{loggingOut ? 'Выход...' : 'Выйти'}</span>
              </button>
            </>
          )}

          <ThemeToggle />
        </div>
      </div>

      {logoutError && (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--status-repair-bg)',
            borderColor: 'var(--status-repair-border)',
            color: 'var(--status-repair-text)',
          }}
          className="border-t px-3 py-1.5 text-center text-xs font-medium sm:px-6"
        >
          {logoutError}
        </div>
      )}
    </header>
  );
}
