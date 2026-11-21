import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandIcon } from '@/components/BrandIcon';
import { StatusBadge } from '@/components/StatusBadge';
import { TopBar } from '@/components/TopBar';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
    mockMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('toggles document.documentElement.dataset.theme between dark and light and persists to localStorage', () => {
    render(<ThemeToggle />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('taxi_theme')).toBe('dark');

    fireEvent.click(button);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('taxi_theme')).toBe('light');
  });

  it('respects prefers-color-scheme dark when taxi_theme is unset', () => {
    mockMatchMedia(true);

    render(<ThemeToggle />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('taxi_theme')).toBeNull();

    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('taxi_theme')).toBe('light');
  });

  it('uses saved taxi_theme from localStorage over system preference', () => {
    mockMatchMedia(true);
    localStorage.setItem('taxi_theme', 'light');

    render(<ThemeToggle />);

    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('BrandIcon', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders distinct accessible labels for known brands (case-insensitive) and fallback for unknown brand', () => {
    const { rerender } = render(<BrandIcon brand="Kia" />);
    const kiaIcon = screen.getByRole('img', { name: /Kia/i });
    const kiaLabel = kiaIcon.getAttribute('aria-label');
    expect(kiaIcon).toBeInTheDocument();
    expect(kiaIcon).toHaveAttribute('data-brand', 'kia');

    rerender(<BrandIcon brand="hyundai" />);
    const hyundaiIcon = screen.getByRole('img', { name: /hyundai/i });
    expect(hyundaiIcon).toHaveAttribute('data-brand', 'hyundai');

    rerender(<BrandIcon brand="UnknownBrand" />);
    const fallbackIcon = screen.getByRole('img', { name: /UnknownBrand/i });
    expect(fallbackIcon).toBeInTheDocument();
    expect(fallbackIcon).toHaveAttribute('data-brand', 'fallback');
    expect(fallbackIcon.getAttribute('aria-label')).not.toBe(kiaLabel);
  });

  it.each([
    ['Kia', 'kia'],
    ['Hyundai', 'hyundai'],
    ['Skoda', 'skoda'],
    ['Volkswagen', 'volkswagen'],
    ['Toyota', 'toyota'],
    ['Lada', 'lada'],
    ['Geely', 'geely'],
    ['Chery', 'chery'],
    ['Haval', 'haval'],
  ])('renders emblem for %s', (brand, expectedKey) => {
    render(<BrandIcon brand={brand} />);
    const icon = screen.getByRole('img', { name: new RegExp(brand, 'i') });
    expect(icon).toHaveAttribute('data-brand', expectedKey);
  });
});

describe('StatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    ['in_rent', 'В аренде'],
    ['in_repair', 'На ремонте'],
    ['available', 'Не в аренде'],
  ] as const)('renders Russian status label for %s', (status, label) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();
    expect(badge.closest('[data-status]')).toHaveAttribute('data-status', status);
  });
});

describe('TopBar', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    mockMatchMedia(false);
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders user badge, logout button, and theme toggle when logged in', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<TopBar user={{ id: 1, username: 'admin', role: 'admin' }} />);

    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /тем/i })).toBeInTheDocument();

    const logoutBtn = screen.getByRole('button', { name: 'Выйти' });
    fireEvent.click(logoutBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
      expect(pushMock).toHaveBeenCalledWith('/login');
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it('hides logout button and keeps theme toggle when user is null', () => {
    render(<TopBar user={null} />);

    expect(screen.queryByRole('button', { name: 'Выйти' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /тем/i })).toBeInTheDocument();
  });

  it('re-enables logout button without redirecting if logout fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    render(<TopBar user={{ id: 2, username: 'viewer', role: 'viewer' }} />);

    const logoutBtn = screen.getByRole('button', { name: 'Выйти' });
    fireEvent.click(logoutBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
      expect(logoutBtn).not.toBeDisabled();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
