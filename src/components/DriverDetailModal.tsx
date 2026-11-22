'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Archive, ArchiveRestore, Car, Phone, User } from 'lucide-react';
import type { RentalPeriodicity, UserRole } from '@/db/schema';
import { formatDateRu, formatDateTimeRu, formatRub } from '@/lib/format';
import {
  updateDriverSchema,
  type DriverDetailDto,
} from '@/lib/validation';
import { FineStatusPill } from './FinesListModal';
import { ModalShell } from './ModalShell';

const PERIODICITY_RATE_LABEL: Record<RentalPeriodicity, string> = {
  daily: 'в день',
  weekly: 'в неделю',
  monthly: 'в месяц',
};

const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60';

const TEXTAREA_CLASS =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60';

const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-[var(--text-secondary)]';

type FeedbackState = { kind: 'error' | 'success'; message: string } | null;

async function readApiError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? fallback;
}

/** Modal showing full driver contacts, active/past rentals, fines, and admin edit/archive actions. */
export function DriverDetailModal({
  driverId,
  userRole,
  onClose,
  onUpdated,
}: {
  driverId: number;
  userRole: UserRole;
  onClose: () => void;
  onUpdated: (driver: DriverDetailDto) => void;
}) {
  const [driver, setDriver] = useState<DriverDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    async function loadDriver() {
      try {
        const response = await fetch(`/api/drivers/${driverId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!response.ok) {
          setLoadError(await readApiError(response, 'Не удалось загрузить карточку водителя'));
          return;
        }

        const data = (await response.json()) as { driver?: DriverDetailDto };
        if (controller.signal.aborted) return;

        if (!data.driver) {
          setLoadError('Карточка водителя не загрузилась');
          return;
        }

        setDriver(data.driver);
        setFullName(data.driver.fullName);
        setPhone(data.driver.phone ?? '');
        setNotes(data.driver.notes ?? '');
        setFeedback(null);
      } catch {
        if (!controller.signal.aborted) {
          setLoadError('Не удалось загрузить карточку. Проверьте сеть');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadDriver();
    return () => controller.abort();
  }, [driverId, reloadNonce]);

  const visibleDriver = driver && driver.id === driverId ? driver : null;
  const busy = saving || archiving;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!visibleDriver || busy) return;
    setFeedback(null);

    const parsed = updateDriverSchema.safeParse({
      fullName,
      phone,
      notes,
    });

    if (!parsed.success) {
      setFeedback({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Некорректные данные водителя',
      });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/drivers/${visibleDriver.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!response.ok) {
        setFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось сохранить данные водителя'),
        });
        return;
      }

      const data = (await response.json()) as { driver?: DriverDetailDto };
      if (data.driver) {
        setDriver(data.driver);
        setFullName(data.driver.fullName);
        setPhone(data.driver.phone ?? '');
        setNotes(data.driver.notes ?? '');
        onUpdated(data.driver);
      }
      setFeedback({ kind: 'success', message: 'Данные водителя обновлены' });
    } catch {
      setFeedback({ kind: 'error', message: 'Не удалось сохранить изменения. Проверьте сеть' });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleArchive() {
    if (!visibleDriver || busy) return;
    setFeedback(null);
    setArchiving(true);
    const nextArchived = !visibleDriver.archived;

    try {
      const response = await fetch(`/api/drivers/${visibleDriver.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: nextArchived }),
      });

      if (!response.ok) {
        setFeedback({
          kind: 'error',
          message: await readApiError(response, 'Не удалось изменить статус архива'),
        });
        return;
      }

      const data = (await response.json()) as { driver?: DriverDetailDto };
      if (data.driver) {
        setDriver(data.driver);
        onUpdated(data.driver);
      }
      setFeedback({
        kind: 'success',
        message: nextArchived ? 'Водитель переведён в архив' : 'Водитель возвращён из архива',
      });
    } catch {
      setFeedback({ kind: 'error', message: 'Не удалось обновить статус. Проверьте сеть' });
    } finally {
      setArchiving(false);
    }
  }

  return (
    <ModalShell
      title={
        visibleDriver ? (
          <span className="inline-flex max-w-full min-w-0 items-center gap-2">
            <User className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
            <span className="truncate">{visibleDriver.fullName}</span>
          </span>
        ) : (
          'Карточка водителя'
        )
      }
      headerMeta={
        visibleDriver ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              style={
                visibleDriver.archived
                  ? {
                      backgroundColor: 'var(--status-available-bg)',
                      borderColor: 'var(--status-available-border)',
                      color: 'var(--status-available-text)',
                    }
                  : {
                      backgroundColor: 'var(--status-rent-bg)',
                      borderColor: 'var(--status-rent-border)',
                      color: 'var(--status-rent-text)',
                    }
              }
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap"
            >
              {visibleDriver.archived ? 'В архиве' : 'Активный'}
            </span>

            {visibleDriver.phone && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] tabular-nums sm:text-sm">
                <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{visibleDriver.phone}</span>
              </span>
            )}

            {visibleDriver.rentDebt30d > 0 && (
              <span
                style={{
                  backgroundColor: 'var(--status-overdue-bg)',
                  borderColor: 'var(--status-overdue-border)',
                  color: 'var(--status-overdue-text)',
                }}
                className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
              >
                Долг аренды: {formatRub(visibleDriver.rentDebt30d)}
              </span>
            )}

            {visibleDriver.unpaidFinesCount > 0 && (
              <span
                style={{
                  backgroundColor: 'var(--status-repair-bg)',
                  borderColor: 'var(--status-repair-border)',
                  color: 'var(--status-repair-text)',
                }}
                className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
              >
                Штрафы: {formatRub(visibleDriver.unpaidFinesSum)} ({visibleDriver.unpaidFinesCount}{' '}
                шт.)
              </span>
            )}
          </div>
        ) : undefined
      }
      onClose={onClose}
      closeDisabled={busy}
      maxWidthClass="max-w-2xl"
      zIndexClass="z-50"
    >
      {loading && visibleDriver === null ? (
        <div aria-busy="true" aria-label="Загрузка карточки водителя" className="space-y-3">
          <div className="h-24 rounded-xl bg-[var(--bg-elevated)]" />
          <div className="h-28 rounded-xl bg-[var(--bg-elevated)]" />
          <div className="h-20 rounded-xl bg-[var(--bg-elevated)]" />
        </div>
      ) : loadError && visibleDriver === null ? (
        <div className="space-y-3 rounded-xl border border-[var(--status-repair-border)] bg-[var(--status-repair-bg)] p-4">
          <p
            role="alert"
            style={{ color: 'var(--status-repair-text)' }}
            className="text-sm font-medium"
          >
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
          >
            Повторить
          </button>
        </div>
      ) : visibleDriver ? (
        <div className="space-y-5">
          <section aria-label="Контакты и заметка" className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Контакты и заметка
            </h3>

            {userRole === 'admin' ? (
              <form onSubmit={handleSave} noValidate className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="driver-detail-full-name" className={LABEL_CLASS}>
                      ФИО
                    </label>
                    <input
                      id="driver-detail-full-name"
                      name="fullName"
                      type="text"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      disabled={busy}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label htmlFor="driver-detail-phone" className={LABEL_CLASS}>
                      Телефон
                    </label>
                    <input
                      id="driver-detail-phone"
                      name="phone"
                      type="text"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      disabled={busy}
                      placeholder="+7 916 111-22-33"
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="driver-detail-notes" className={LABEL_CLASS}>
                    Заметка
                  </label>
                  <textarea
                    id="driver-detail-notes"
                    name="notes"
                    rows={2}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    disabled={busy}
                    placeholder="Комментарий по водителю"
                    className={TEXTAREA_CLASS}
                  />
                </div>

                {feedback && (
                  <p
                    role={feedback.kind === 'error' ? 'alert' : 'status'}
                    style={{
                      backgroundColor:
                        feedback.kind === 'error'
                          ? 'var(--status-repair-bg)'
                          : 'var(--status-rent-bg)',
                      borderColor:
                        feedback.kind === 'error'
                          ? 'var(--status-repair-border)'
                          : 'var(--status-rent-border)',
                      color:
                        feedback.kind === 'error'
                          ? 'var(--status-repair-text)'
                          : 'var(--status-rent-text)',
                    }}
                    className="rounded-lg border px-3 py-2 text-xs font-medium sm:text-sm"
                  >
                    {feedback.message}
                  </p>
                )}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void handleToggleArchive();
                    }}
                    className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {visibleDriver.archived ? (
                      <>
                        <ArchiveRestore className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{archiving ? 'Восстановление...' : 'Вернуть из архива'}</span>
                      </>
                    ) : (
                      <>
                        <Archive className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{archiving ? 'Архивация...' : 'Архивировать'}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {saving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              </form>
            ) : (
              <dl className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm">
                <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <dt className="text-xs text-[var(--text-secondary)]">Телефон</dt>
                  <dd className="font-medium text-[var(--text-primary)] tabular-nums sm:text-right">
                    {visibleDriver.phone ?? 'Не указан'}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <dt className="text-xs text-[var(--text-secondary)]">Заметка</dt>
                  <dd className="text-xs text-[var(--text-primary)] sm:max-w-sm sm:text-right sm:text-sm">
                    {visibleDriver.notes ?? 'Заметок нет'}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <dt className="text-xs text-[var(--text-secondary)]">Добавлен</dt>
                  <dd className="text-xs font-medium text-[var(--text-secondary)] tabular-nums sm:text-right">
                    {formatDateRu(visibleDriver.createdAt)}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <section aria-label="Аренды" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Аренды ({visibleDriver.rentalsHistory.length})
              </h3>
            </div>

            {visibleDriver.rentalsHistory.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-3.5 py-4 text-center text-xs text-[var(--text-secondary)]">
                Аренд пока нет
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                {visibleDriver.rentalsHistory.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-2 px-3.5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Car
                          className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]"
                          aria-hidden="true"
                        />
                        <span className="font-semibold text-[var(--text-primary)]">
                          {item.carBrand} {item.carModel}
                        </span>
                        <span className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
                          {item.carPlate}
                        </span>
                        <span
                          style={
                            item.active
                              ? {
                                  backgroundColor: 'var(--status-rent-bg)',
                                  borderColor: 'var(--status-rent-border)',
                                  color: 'var(--status-rent-text)',
                                }
                              : {
                                  backgroundColor: 'var(--status-available-bg)',
                                  borderColor: 'var(--status-available-border)',
                                  color: 'var(--status-available-text)',
                                }
                          }
                          className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        >
                          {item.active ? 'Активна' : 'Завершена'}
                        </span>
                      </div>

                      <p className="text-[var(--text-secondary)] tabular-nums">
                        {item.active
                          ? `с ${formatDateRu(item.startDate)}, по настоящее время`
                          : `с ${formatDateRu(item.startDate)} по ${formatDateRu(item.endDate ?? item.startDate)}`}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                      <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                        {formatRub(item.rateAmount)} {PERIODICITY_RATE_LABEL[item.periodicity]}
                      </span>
                      {item.rentDebt30d > 0 && (
                        <span
                          style={{
                            backgroundColor: 'var(--status-overdue-bg)',
                            borderColor: 'var(--status-overdue-border)',
                            color: 'var(--status-overdue-text)',
                          }}
                          className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
                        >
                          Долг (30 дн.): {formatRub(item.rentDebt30d)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Штрафы водителя" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Штрафы ({visibleDriver.fines.length})
              </h3>
              {visibleDriver.unpaidFinesCount > 0 && (
                <span
                  style={{ color: 'var(--status-repair-text)' }}
                  className="text-xs font-medium tabular-nums"
                >
                  Неоплаченных: {visibleDriver.unpaidFinesCount} (
                  {formatRub(visibleDriver.unpaidFinesSum)})
                </span>
              )}
            </div>

            {visibleDriver.fines.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-3.5 py-4 text-center text-xs text-[var(--text-secondary)]">
                Штрафов нет
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                {visibleDriver.fines.map((fine) => (
                  <li
                    key={fine.id}
                    className="flex flex-col gap-2 px-3.5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {fine.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[var(--text-secondary)]">
                        <span className="tabular-nums">{formatDateTimeRu(fine.violatedAt)}</span>
                        <span className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
                          {fine.carPlate}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums">
                          {fine.resolutionNumber}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                      <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                        {formatRub(fine.amount)}
                      </span>
                      <FineStatusPill status={fine.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </ModalShell>
  );
}
