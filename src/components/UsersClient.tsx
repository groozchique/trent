'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Pencil, Trash2, UserPlus } from 'lucide-react';
import type { UserRole } from '@/db/schema';
import { formatDateRu } from '@/lib/format';
import {
  createUserSchema,
  updateUserSchema,
  type SafeUserDto,
} from '@/lib/validation';

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Администратор',
  viewer: 'Просмотр',
  owner: 'Собственник',
};

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'viewer', label: 'Просмотр' },
  { value: 'owner', label: 'Собственник' },
  { value: 'admin', label: 'Администратор' },
];

const ROLE_BADGE_STYLES: Record<
  UserRole,
  { backgroundColor: string; borderColor: string; color: string }
> = {
  admin: {
    backgroundColor: 'var(--status-rent-bg)',
    borderColor: 'var(--status-rent-border)',
    color: 'var(--status-rent-text)',
  },
  owner: {
    backgroundColor: 'var(--status-overdue-bg)',
    borderColor: 'var(--status-overdue-border)',
    color: 'var(--status-overdue-text)',
  },
  viewer: {
    backgroundColor: 'var(--status-available-bg)',
    borderColor: 'var(--status-available-border)',
    color: 'var(--status-available-text)',
  },
};

const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60';

const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-[var(--text-secondary)]';

const SECONDARY_BTN_CLASS =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm';

type FeedbackState = { kind: 'error' | 'success'; message: string } | null;

async function readApiError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? fallback;
}

function FeedbackBanner({ feedback }: { feedback: FeedbackState }) {
  if (!feedback) return null;
  const isError = feedback.kind === 'error';

  return (
    <p
      role={isError ? 'alert' : 'status'}
      style={{
        backgroundColor: isError ? 'var(--status-repair-bg)' : 'var(--status-rent-bg)',
        borderColor: isError ? 'var(--status-repair-border)' : 'var(--status-rent-border)',
        color: isError ? 'var(--status-repair-text)' : 'var(--status-rent-text)',
      }}
      className="rounded-lg border px-3 py-2 text-xs font-medium sm:text-sm"
    >
      {feedback.message}
    </p>
  );
}

/** Admin user-management console with creation, role updates, password reset, and safe deletion. */
export function UsersClient({
  initialUsers,
  currentUserId,
}: {
  initialUsers: SafeUserDto[];
  currentUserId: number;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<SafeUserDto[]>(initialUsers);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [creating, setCreating] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<FeedbackState>(null);

  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [editNameUserId, setEditNameUserId] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [resetPasswordUserId, setResetPasswordUserId] = useState<number | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);
  const [listFeedback, setListFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  const adminCount = users.filter((item) => item.role === 'admin').length;
  const ownerCount = users.filter((item) => item.role === 'owner').length;

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreateFeedback(null);
    setListFeedback(null);

    const parsed = createUserSchema.safeParse({
      username,
      displayName,
      password,
      role,
    });

    if (!parsed.success) {
      setCreateFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные пользователя',
      });
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setCreateFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось создать пользователя'),
        });
        return;
      }

      const data = (await response.json()) as { user?: SafeUserDto };
      if (data.user) {
        const createdUser = data.user;
        setUsers((prev) =>
          prev.some((item) => item.id === createdUser.id) ? prev : [...prev, createdUser],
        );
      }
      setUsername('');
      setDisplayName('');
      setPassword('');
      setRole('viewer');
      setCreateFeedback({
        kind: 'success',
        message: `Пользователь «${parsed.data.username}» создан`,
      });
      router.refresh();
    } catch {
      setCreateFeedback({
        kind: 'error',
        message: 'Не удалось создать пользователя. Проверьте сеть',
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdateDisplayName(
    event: FormEvent<HTMLFormElement>,
    targetUser: SafeUserDto,
  ) {
    event.preventDefault();
    if (pendingUserId !== null) return;
    setCreateFeedback(null);
    setListFeedback(null);

    const parsed = updateUserSchema.safeParse({ displayName: editNameValue });
    if (!parsed.success) {
      setListFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректное имя пользователя',
      });
      return;
    }

    setPendingUserId(targetUser.id);
    try {
      const response = await fetch(`/api/users/${targetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setListFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось обновить имя пользователя'),
        });
        return;
      }

      const data = (await response.json()) as { user?: SafeUserDto };
      if (data.user) {
        const updatedUser = data.user;
        setUsers((prev) => prev.map((item) => (item.id === updatedUser.id ? updatedUser : item)));
      }
      setEditNameUserId(null);
      setEditNameValue('');
      setListFeedback({
        kind: 'success',
        message: `Имя пользователя «${targetUser.username}» обновлено`,
      });
      router.refresh();
    } catch {
      setListFeedback({
        kind: 'error',
        message: 'Не удалось обновить имя. Проверьте сеть',
      });
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleRoleChange(targetUser: SafeUserDto, nextRole: UserRole) {
    if (pendingUserId !== null || nextRole === targetUser.role) return;
    setCreateFeedback(null);
    setListFeedback(null);
    setPendingUserId(targetUser.id);

    try {
      const response = await fetch(`/api/users/${targetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });

      if (!response.ok) {
        setListFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось изменить роль пользователя'),
        });
        return;
      }

      const data = (await response.json()) as { user?: SafeUserDto };
      if (data.user) {
        const updatedUser = data.user;
        setUsers((prev) => prev.map((item) => (item.id === updatedUser.id ? updatedUser : item)));
      }
      setListFeedback({
        kind: 'success',
        message: `Роль пользователя «${targetUser.username}» обновлена`,
      });
      router.refresh();
    } catch {
      setListFeedback({
        kind: 'error',
        message: 'Не удалось обновить роль. Проверьте сеть',
      });
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>, targetUser: SafeUserDto) {
    event.preventDefault();
    if (pendingUserId !== null) return;
    setCreateFeedback(null);
    setListFeedback(null);

    const parsed = updateUserSchema.safeParse({ password: resetPasswordValue });
    if (!parsed.success) {
      setListFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректный пароль',
      });
      return;
    }

    setPendingUserId(targetUser.id);
    try {
      const response = await fetch(`/api/users/${targetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setListFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось сбросить пароль'),
        });
        return;
      }

      setResetPasswordUserId(null);
      setResetPasswordValue('');
      setListFeedback({
        kind: 'success',
        message: `Пароль пользователя «${targetUser.username}» обновлён`,
      });
      router.refresh();
    } catch {
      setListFeedback({
        kind: 'error',
        message: 'Не удалось обновить пароль. Проверьте сеть',
      });
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleDeleteUser(targetUser: SafeUserDto) {
    if (pendingUserId !== null) return;
    setCreateFeedback(null);
    setListFeedback(null);
    setPendingUserId(targetUser.id);

    try {
      const response = await fetch(`/api/users/${targetUser.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setListFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось удалить пользователя'),
        });
        return;
      }

      setUsers((prev) => prev.filter((item) => item.id !== targetUser.id));
      setConfirmDeleteUserId(null);
      setListFeedback({
        kind: 'success',
        message: `Пользователь «${targetUser.username}» удалён`,
      });
      router.refresh();
    } catch {
      setListFeedback({
        kind: 'error',
        message: 'Не удалось удалить пользователя. Проверьте сеть',
      });
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-3 py-5 sm:px-6 sm:py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">
          Пользователи
        </h1>
        <p className="mt-1 text-xs text-[var(--text-secondary)] sm:text-sm">
          Учётных записей:{' '}
          <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
            {users.length}
          </strong>
          {', '}администраторов:{' '}
          <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
            {adminCount}
          </strong>
          {', '}собственников:{' '}
          <strong className="font-semibold text-[var(--text-primary)] tabular-nums">
            {ownerCount}
          </strong>
        </p>
      </div>

      <section
        aria-label="Новый пользователь"
        className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:mt-5 sm:p-5"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Новый пользователь</h2>

        <form onSubmit={handleCreateUser} noValidate className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="create-user-username" className={LABEL_CLASS}>
                Логин
              </label>
              <input
                id="create-user-username"
                name="username"
                type="text"
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={creating}
                placeholder="operator"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="create-user-display-name" className={LABEL_CLASS}>
                Имя / ФИО (необязательно)
              </label>
              <input
                id="create-user-display-name"
                name="displayName"
                type="text"
                autoComplete="off"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={creating}
                placeholder="Сергей Волков"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="create-user-password" className={LABEL_CLASS}>
                Пароль
              </label>
              <input
                id="create-user-password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={creating}
                placeholder="Минимум 6 символов"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="create-user-role" className={LABEL_CLASS}>
                Роль
              </label>
              <select
                id="create-user-role"
                name="role"
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                disabled={creating}
                className={INPUT_CLASS}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <FeedbackBanner feedback={createFeedback} />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{creating ? 'Создание...' : 'Создать пользователя'}</span>
            </button>
          </div>
        </form>
      </section>

      <section
        aria-label="Список пользователей"
        className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 sm:mt-5 sm:p-5"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Учётные записи</h2>

        {listFeedback && (
          <div className="mt-3">
            <FeedbackBanner feedback={listFeedback} />
          </div>
        )}

        <ul className="mt-4 space-y-3">
          {users.map((item) => {
            const isSelf = item.id === currentUserId;
            const isSoleAdmin = item.role === 'admin' && adminCount <= 1;
            const rowBusy = pendingUserId !== null || creating;
            const isEditNameOpen = editNameUserId === item.id;
            const isResetOpen = resetPasswordUserId === item.id;
            const isDeleteOpen = confirmDeleteUserId === item.id;

            return (
              <li
                key={item.id}
                data-testid={`user-row-${item.id}`}
                className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.displayName ? (
                        <>
                          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {item.displayName}
                          </span>
                          <span className="truncate text-xs text-[var(--text-muted)]">
                            Логин: {item.username}
                          </span>
                        </>
                      ) : (
                        <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {item.username}
                        </span>
                      )}

                      {isSelf && (
                        <span className="inline-flex items-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs font-medium text-[var(--text-primary)]">
                          Вы
                        </span>
                      )}

                      <span
                        style={ROLE_BADGE_STYLES[item.role]}
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                      >
                        {ROLE_LABELS[item.role]}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                      Создан {formatDateRu(item.createdAt)}
                      {isSoleAdmin ? ', единственный администратор' : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Роль пользователя ${item.username}`}
                      value={item.role}
                      disabled={rowBusy || isSoleAdmin}
                      onChange={(event) => {
                        void handleRoleChange(item, event.target.value as UserRole);
                      }}
                      className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => {
                        setListFeedback(null);
                        setConfirmDeleteUserId(null);
                        setResetPasswordUserId(null);
                        setResetPasswordValue('');
                        if (isEditNameOpen) {
                          setEditNameUserId(null);
                          setEditNameValue('');
                        } else {
                          setEditNameUserId(item.id);
                          setEditNameValue(item.displayName ?? '');
                        }
                      }}
                      className={SECONDARY_BTN_CLASS}
                    >
                      <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Изменить имя</span>
                    </button>

                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => {
                        setListFeedback(null);
                        setConfirmDeleteUserId(null);
                        setEditNameUserId(null);
                        setEditNameValue('');
                        setResetPasswordValue('');
                        setResetPasswordUserId(isResetOpen ? null : item.id);
                      }}
                      className={SECONDARY_BTN_CLASS}
                    >
                      <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Сбросить пароль</span>
                    </button>

                    <button
                      type="button"
                      disabled={rowBusy || isSelf || isSoleAdmin}
                      onClick={() => {
                        setListFeedback(null);
                        setEditNameUserId(null);
                        setEditNameValue('');
                        setResetPasswordUserId(null);
                        setResetPasswordValue('');
                        setConfirmDeleteUserId(isDeleteOpen ? null : item.id);
                      }}
                      style={{
                        backgroundColor: 'var(--status-repair-bg)',
                        borderColor: 'var(--status-repair-border)',
                        color: 'var(--status-repair-text)',
                      }}
                      className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 sm:text-sm"
                    >
                      <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Удалить</span>
                    </button>
                  </div>
                </div>

                {isEditNameOpen && (
                  <form
                    onSubmit={(event) => {
                      void handleUpdateDisplayName(event, item);
                    }}
                    noValidate
                    className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:flex-row sm:items-end"
                  >
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`edit-name-${item.id}`} className={LABEL_CLASS}>
                        Имя / ФИО
                      </label>
                      <input
                        id={`edit-name-${item.id}`}
                        name="displayName"
                        type="text"
                        autoComplete="off"
                        value={editNameValue}
                        onChange={(event) => setEditNameValue(event.target.value)}
                        disabled={rowBusy}
                        placeholder="Не указано"
                        className={INPUT_CLASS}
                      />
                    </div>

                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => {
                          setEditNameUserId(null);
                          setEditNameValue('');
                        }}
                        className={SECONDARY_BTN_CLASS}
                      >
                        Отмена
                      </button>
                      <button
                        type="submit"
                        disabled={rowBusy}
                        className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                      >
                        {pendingUserId === item.id ? 'Сохранение...' : 'Сохранить имя'}
                      </button>
                    </div>
                  </form>
                )}

                {isResetOpen && (
                  <form
                    onSubmit={(event) => {
                      void handleResetPassword(event, item);
                    }}
                    noValidate
                    className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:flex-row sm:items-end"
                  >
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`reset-password-${item.id}`} className={LABEL_CLASS}>
                        Новый пароль
                      </label>
                      <input
                        id={`reset-password-${item.id}`}
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        value={resetPasswordValue}
                        onChange={(event) => setResetPasswordValue(event.target.value)}
                        disabled={rowBusy}
                        placeholder="Минимум 6 символов"
                        className={INPUT_CLASS}
                      />
                    </div>

                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => {
                          setResetPasswordUserId(null);
                          setResetPasswordValue('');
                        }}
                        className={SECONDARY_BTN_CLASS}
                      >
                        Отмена
                      </button>
                      <button
                        type="submit"
                        disabled={rowBusy}
                        className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                      >
                        {pendingUserId === item.id ? 'Сохранение...' : 'Сохранить пароль'}
                      </button>
                    </div>
                  </form>
                )}

                {isDeleteOpen && (
                  <div
                    style={{
                      backgroundColor: 'var(--status-repair-bg)',
                      borderColor: 'var(--status-repair-border)',
                    }}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p
                      style={{ color: 'var(--status-repair-text)' }}
                      className="text-xs font-medium sm:text-sm"
                    >
                      Удалить пользователя {item.username}? Отменить это нельзя.
                    </p>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => setConfirmDeleteUserId(null)}
                        className={SECONDARY_BTN_CLASS}
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => {
                          void handleDeleteUser(item);
                        }}
                        style={{
                          backgroundColor: 'var(--status-danger)',
                          color: 'var(--status-danger-fg)',
                        }}
                        className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg px-3 text-xs font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                      >
                        {pendingUserId === item.id ? 'Удаление...' : 'Да, удалить'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
