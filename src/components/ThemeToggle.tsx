'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

export const THEME_STORAGE_KEY = 'taxi_theme';
export type ThemeMode = 'light' | 'dark';

const listeners = new Set<() => void>();

function notifyThemeListeners() {
  for (const listener of listeners) listener();
}

function readStoredTheme(): ThemeMode | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

function readSystemTheme(): ThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getClientThemeSnapshot(): ThemeMode {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.theme;
    if (attr === 'light' || attr === 'dark') return attr;
  }
  return readStoredTheme() ?? readSystemTheme();
}

function syncDomTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function applyThemePreference(theme: ThemeMode) {
  syncDomTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures (e.g., restricted browser context).
  }
  notifyThemeListeners();
}

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);

  const media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  const onMediaChange = (event: MediaQueryListEvent) => {
    if (readStoredTheme() !== null) return;
    syncDomTheme(event.matches ? 'dark' : 'light');
    notifyThemeListeners();
  };

  const onStorageChange = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const next = readStoredTheme() ?? readSystemTheme();
    syncDomTheme(next);
    notifyThemeListeners();
  };

  media?.addEventListener?.('change', onMediaChange);
  window.addEventListener('storage', onStorageChange);

  return () => {
    listeners.delete(listener);
    media?.removeEventListener?.('change', onMediaChange);
    window.removeEventListener('storage', onStorageChange);
  };
}

/** Compact theme toggle pinned in the top bar; persists `taxi_theme` in localStorage. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getClientThemeSnapshot, () => null);

  useEffect(() => {
    if (theme && document.documentElement.dataset.theme !== theme) {
      syncDomTheme(theme);
    }
  }, [theme]);

  function handleToggle() {
    const current = theme ?? getClientThemeSnapshot();
    applyThemePreference(current === 'dark' ? 'light' : 'dark');
  }

  const label =
    theme === 'dark'
      ? 'Переключить на светлую тему'
      : theme === 'light'
        ? 'Переключить на тёмную тему'
        : 'Переключить тему';

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
