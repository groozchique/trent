import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionUser } from '@/lib/auth/session';
import type { SafeUserDto } from '@/lib/validation';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const redirectMock = vi.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const getCurrentUserMock = vi.fn<() => Promise<SessionUser | null>>();
const listUsersSafeMock = vi.fn<() => Promise<SafeUserDto[]>>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  redirect: (url: string) => redirectMock(url),
}));

vi.mock('@/db', () => ({
  db: {},
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

vi.mock('@/lib/users', () => ({
  listUsersSafe: () => listUsersSafeMock(),
}));

import UsersPage from '@/app/users/page';
import { UsersClient } from '@/components/UsersClient';

const SAMPLE_USERS: SafeUserDto[] = [
  {
    id: 1,
    username: 'admin',
    role: 'admin',
    createdAt: '2026-10-01T10:00:00Z',
  },
  {
    id: 2,
    username: 'viewer',
    role: 'viewer',
    createdAt: '2026-10-05T12:00:00Z',
  },
];

describe('UsersPage SSR guard', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
    listUsersSafeMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('redirects unauthenticated guest to /login', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(UsersPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(listUsersSafeMock).not.toHaveBeenCalled();
  });

  it('redirects viewer user to /', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 2, username: 'viewer', role: 'viewer' });

    await expect(UsersPage()).rejects.toThrow('NEXT_REDIRECT:/');
    expect(redirectMock).toHaveBeenCalledWith('/');
    expect(listUsersSafeMock).not.toHaveBeenCalled();
  });

  it('renders UsersClient for admin', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 1, username: 'admin', role: 'admin' });
    listUsersSafeMock.mockResolvedValue(SAMPLE_USERS);

    const element = await UsersPage();
    render(element);

    expect(listUsersSafeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Пользователи' })).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });
});

describe('UsersClient', () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('validates create user form with Zod and handles 409 + 201 POST /api/users', async () => {
    const createdUser: SafeUserDto = {
      id: 3,
      username: 'operator',
      role: 'viewer',
      createdAt: '2026-11-22T01:00:00Z',
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Пользователь с таким логином уже существует' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ user: createdUser }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<UsersClient initialUsers={SAMPLE_USERS} currentUserId={1} />);

    const usernameInput = screen.getByLabelText('Логин');
    const passwordInput = screen.getByLabelText('Пароль');
    const roleSelect = screen.getByLabelText('Роль');
    const submitBtn = screen.getByRole('button', { name: 'Создать пользователя' });

    // Too short username -> inline error without fetch
    fireEvent.change(usernameInput, { target: { value: 'ab' } });
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });
    fireEvent.click(submitBtn);
    expect(screen.getByRole('alert')).toHaveTextContent('Логин должен содержать минимум 3 символа');
    expect(fetchMock).not.toHaveBeenCalled();

    // Whitespace in username -> inline error without fetch
    fireEvent.change(usernameInput, { target: { value: 'bad user' } });
    fireEvent.click(submitBtn);
    expect(screen.getByRole('alert')).toHaveTextContent('Логин не должен содержать пробелы');
    expect(fetchMock).not.toHaveBeenCalled();

    // Short password -> inline error without fetch
    fireEvent.change(usernameInput, { target: { value: 'admin' } });
    fireEvent.change(passwordInput, { target: { value: '12345' } });
    fireEvent.click(submitBtn);
    expect(screen.getByRole('alert')).toHaveTextContent('Пароль должен содержать минимум 6 символов');
    expect(fetchMock).not.toHaveBeenCalled();

    // Server 409 conflict
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Пользователь с таким логином уже существует',
      );
    });

    // Successful create
    fireEvent.change(usernameInput, { target: { value: ' operator ' } });
    fireEvent.change(roleSelect, { target: { value: 'viewer' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'operator',
          password: 'secret123',
          role: 'viewer',
        }),
      });
      expect(screen.getByText('operator')).toBeInTheDocument();
    });
    expect(usernameInput).toHaveValue('');
    expect(passwordInput).toHaveValue('');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('protects sole admin and self from deletion, allows role updates, and performs two-step delete', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/users/2' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 2,
              username: 'viewer',
              role: 'admin',
              createdAt: '2026-10-05T12:00:00Z',
            },
          }),
        });
      }
      if (url === '/api/users/2' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<UsersClient initialUsers={SAMPLE_USERS} currentUserId={1} />);

    const adminRow = screen.getByTestId('user-row-1');
    const viewerRow = screen.getByTestId('user-row-2');

    // Sole admin & self: delete disabled and role selector disabled
    expect(within(adminRow).getByRole('button', { name: 'Удалить' })).toBeDisabled();
    expect(within(adminRow).getByLabelText('Роль пользователя admin')).toBeDisabled();

    // Viewer row: delete enabled
    expect(within(viewerRow).getByRole('button', { name: 'Удалить' })).not.toBeDisabled();

    // Promote viewer -> admin via inline role selector
    fireEvent.change(within(viewerRow).getByLabelText('Роль пользователя viewer'), {
      target: { value: 'admin' },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/users/2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      });
    });

    // Now there are 2 admins: self delete is STILL disabled, admin role selector is now enabled
    expect(within(adminRow).getByRole('button', { name: 'Удалить' })).toBeDisabled();
    expect(within(adminRow).getByLabelText('Роль пользователя admin')).not.toBeDisabled();

    // Two-step delete on user #2: cancel first, then confirm
    fireEvent.click(within(viewerRow).getByRole('button', { name: 'Удалить' }));
    expect(within(viewerRow).getByRole('button', { name: 'Да, удалить' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(within(viewerRow).getByRole('button', { name: 'Отмена' }));
    expect(within(viewerRow).queryByRole('button', { name: 'Да, удалить' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(within(viewerRow).getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(viewerRow).getByRole('button', { name: 'Да, удалить' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/users/2', { method: 'DELETE' });
      expect(screen.queryByTestId('user-row-2')).not.toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('disables delete for non-self sole admin and resets password with Zod validation', async () => {
    const soleAdminOther: SafeUserDto[] = [
      {
        id: 5,
        username: 'superadmin',
        role: 'admin',
        createdAt: '2026-10-01T10:00:00Z',
      },
      {
        id: 6,
        username: 'operator',
        role: 'viewer',
        createdAt: '2026-10-02T10:00:00Z',
      },
    ];

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ user: soleAdminOther[1] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // currentUserId = 99 (neither row is self, but #5 is sole admin)
    render(<UsersClient initialUsers={soleAdminOther} currentUserId={99} />);

    const soleAdminRow = screen.getByTestId('user-row-5');
    const operatorRow = screen.getByTestId('user-row-6');

    expect(within(soleAdminRow).getByRole('button', { name: 'Удалить' })).toBeDisabled();
    expect(within(operatorRow).getByRole('button', { name: 'Удалить' })).not.toBeDisabled();

    // Reset password flow on operator
    fireEvent.click(within(operatorRow).getByRole('button', { name: 'Сбросить пароль' }));
    const newPasswordInput = within(operatorRow).getByLabelText('Новый пароль');

    fireEvent.change(newPasswordInput, { target: { value: '123' } });
    fireEvent.click(within(operatorRow).getByRole('button', { name: 'Сохранить пароль' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Пароль должен содержать минимум 6 символов');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
    fireEvent.click(within(operatorRow).getByRole('button', { name: 'Сохранить пароль' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/users/6', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'newpass123' }),
      });
    });

    await waitFor(() => {
      expect(within(operatorRow).queryByLabelText('Новый пароль')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
