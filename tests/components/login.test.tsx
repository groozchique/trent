import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from '@/app/login/page';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses design-system theme tokens, neutral username placeholder, and keeps submit disabled on redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 1, username: 'admin', role: 'admin' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginPage />);

    const main = screen.getByRole('main');
    expect(main.className).not.toContain('bg-neutral-');
    expect(main.className).not.toContain('dark:bg-neutral-');

    const usernameInput = screen.getByLabelText('Логин');
    expect(usernameInput).not.toHaveAttribute('placeholder', 'admin');

    fireEvent.change(usernameInput, { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'admin123' } });

    const submitBtn = screen.getByRole('button', { name: 'Войти' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/');
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(submitBtn).toBeDisabled();
  });

  it('shows Russian server error on non-JSON 5xx responses instead of invalid-credentials text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Логин'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'admin123' } });

    const submitBtn = screen.getByRole('button', { name: 'Войти' });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ошибка сервера. Попробуйте позже');
    expect(alert).not.toHaveTextContent('Неверный логин или пароль');
    expect(submitBtn).not.toBeDisabled();
  });
});
