import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandIcon } from '@/components/BrandIcon';
import { StatusBadge } from '@/components/StatusBadge';
import { TopBar } from '@/components/TopBar';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const pathnameMock = vi.fn(() => '/');

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  usePathname: () => pathnameMock(),
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
    pathnameMock.mockReset();
    pathnameMock.mockReturnValue('/');
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

    expect(screen.getByText('tRent')).toBeInTheDocument();
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

    expect(screen.getByText('tRent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Выйти' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /тем/i })).toBeInTheDocument();
  });

  it('shows Russian error feedback and re-enables logout button if logout fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Ошибка завершения сессии' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TopBar user={{ id: 2, username: 'viewer', role: 'viewer' }} />);

    const logoutBtn = screen.getByRole('button', { name: 'Выйти' });
    fireEvent.click(logoutBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent('Ошибка завершения сессии');
    expect(logoutBtn).not.toBeDisabled();
    expect(pushMock).not.toHaveBeenCalled();

    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(logoutBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Не удалось выйти/i);
      expect(logoutBtn).not.toBeDisabled();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('renders role-aware navigation links and highlights active route via usePathname', () => {
    pathnameMock.mockReturnValue('/drivers');
    const { rerender } = render(<TopBar user={{ id: 2, username: 'viewer', role: 'viewer' }} />);

    const fleetLink = screen.getByRole('link', { name: 'Автопарк' });
    const driversLink = screen.getByRole('link', { name: 'Водители' });
    const reportsLink = screen.getByRole('link', { name: 'Отчёты' });
    expect(fleetLink).toHaveAttribute('href', '/');
    expect(driversLink).toHaveAttribute('href', '/drivers');
    expect(reportsLink).toHaveAttribute('href', '/reports');
    expect(fleetLink).not.toHaveAttribute('aria-current', 'page');
    expect(driversLink).toHaveAttribute('aria-current', 'page');
    expect(reportsLink).not.toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Пользователи' })).not.toBeInTheDocument();

    pathnameMock.mockReturnValue('/reports');
    rerender(<TopBar user={{ id: 2, username: 'viewer', role: 'viewer' }} />);
    expect(screen.getByRole('link', { name: 'Отчёты' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Водители' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    pathnameMock.mockReturnValue('/reports/123');
    rerender(<TopBar user={{ id: 2, username: 'viewer', role: 'viewer' }} />);
    expect(screen.getByRole('link', { name: 'Отчёты' })).toHaveAttribute('aria-current', 'page');

    pathnameMock.mockReturnValue('/users');
    rerender(<TopBar user={{ id: 1, username: 'admin', role: 'admin' }} />);
    const navLinks = within(screen.getByRole('navigation', { name: 'Основная навигация' }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(navLinks).toEqual(['Автопарк', 'Водители', 'Отчёты', 'Пользователи']);
    const usersLink = screen.getByRole('link', { name: 'Пользователи' });
    expect(usersLink).toHaveAttribute('href', '/users');
    expect(usersLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Отчёты' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Водители' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    pathnameMock.mockReturnValue('/cars/7/manage');
    rerender(<TopBar user={{ id: 1, username: 'admin', role: 'admin' }} />);
    expect(screen.getByRole('link', { name: 'Автопарк' })).toHaveAttribute('aria-current', 'page');

    rerender(<TopBar user={null} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('wraps nav below md (640px-767px) and moves role badge + single-row layout to md breakpoint', () => {
    const { container } = render(
      <TopBar user={{ id: 1, username: 'admin', role: 'admin' }} />,
    );

    const innerRow = container.querySelector('header > div');
    expect(innerRow).toHaveClass('flex-wrap', 'md:flex-nowrap', 'md:h-14');
    expect(innerRow).not.toHaveClass('sm:flex-nowrap');

    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(nav).toHaveClass('order-3', 'w-full', 'md:order-2', 'md:w-auto');
    expect(nav).not.toHaveClass('sm:order-2');

    const roleLabel = screen.getByText('Администратор');
    expect(roleLabel).toHaveClass('hidden', 'md:inline');
    expect(roleLabel).not.toHaveClass('sm:inline');
  });

  it('renders only Автопарк nav link, displayName in user badge, and Собственник pill for owner role', () => {
    render(
      <TopBar
        user={{ id: 3, username: 'owner1', displayName: 'Сергей Волков', role: 'owner' }}
      />,
    );

    const navLinks = within(screen.getByRole('navigation', { name: 'Основная навигация' }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(navLinks).toEqual(['Автопарк']);
    expect(screen.getByText('Сергей Волков')).toBeInTheDocument();
    expect(screen.queryByText('owner1')).not.toBeInTheDocument();
    expect(screen.getByText('Собственник')).toBeInTheDocument();
  });
});
