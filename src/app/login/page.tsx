'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        const fallback =
          response.status >= 500
            ? 'Ошибка сервера. Попробуйте позже'
            : 'Неверный логин или пароль';
        setError(data?.error ?? fallback);
        setSubmitting(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Не удалось войти. Проверьте сеть');
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[var(--bg-canvas)] px-4 py-8 text-[var(--text-primary)]">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            Вход
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            tRent, управление автопарком
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
            >
              Логин
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              className="h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--border-strong)] disabled:opacity-60"
              placeholder="Логин"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]"
            >
              Пароль
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--border-strong)] disabled:opacity-60"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p
              role="alert"
              style={{
                backgroundColor: 'var(--status-repair-bg)',
                borderColor: 'var(--status-repair-border)',
                color: 'var(--status-repair-text)',
              }}
              className="rounded-lg border px-3 py-2 text-xs font-medium sm:text-sm"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </main>
  );
}
