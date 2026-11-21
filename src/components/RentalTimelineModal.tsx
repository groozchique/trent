'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { RentalPeriodicity, UserRole } from '@/db/schema';
import type { TimelineItem } from '@/lib/rental/timeline';
import type { RentalDto } from '@/lib/validation';
import { formatDateRu, formatRub } from '@/lib/format';
import { ModalShell } from './ModalShell';

const PERIODICITY_SHORT: Record<RentalPeriodicity, string> = {
  daily: 'день',
  weekly: 'неделя',
  monthly: 'месяц',
};

const TIMELINE_STATUS_META: Record<
  TimelineItem['status'],
  { label: string; dotColor: string; pillStyle: CSSProperties }
> = {
  paid: {
    label: 'Оплачен',
    dotColor: 'var(--status-rent-dot)',
    pillStyle: {
      backgroundColor: 'var(--status-rent-bg)',
      borderColor: 'var(--status-rent-border)',
      color: 'var(--status-rent-text)',
    },
  },
  overdue: {
    label: 'Просрочен',
    dotColor: 'var(--status-overdue)',
    pillStyle: {
      backgroundColor: 'var(--status-overdue-bg)',
      borderColor: 'var(--status-overdue-border)',
      color: 'var(--status-overdue-text)',
    },
  },
  upcoming: {
    label: 'Ожидается',
    dotColor: 'var(--status-available-dot)',
    pillStyle: {
      backgroundColor: 'var(--status-available-bg)',
      borderColor: 'var(--status-available-border)',
      color: 'var(--status-available-text)',
    },
  },
};

/** 30-day rental payment timeline modal with yellow overdue highlights and admin toggles. */
export function RentalTimelineModal({
  carId,
  rental,
  timeline,
  userRole,
  onClose,
  onUpdated,
}: {
  carId: number;
  rental: RentalDto | null;
  timeline: TimelineItem[];
  userRole: UserRole;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [items, setItems] = useState<TimelineItem[]>(timeline);
  const [pendingDueDate, setPendingDueDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(timeline);
  }, [timeline]);

  const overdueCount = items.filter((item) => item.status === 'overdue').length;
  const paidCount = items.filter((item) => item.status === 'paid').length;

  async function handleTogglePayment(item: TimelineItem) {
    if (pendingDueDate !== null || rental === null) return;
    setError(null);
    setPendingDueDate(item.dueDate);
    const nextPaid = item.status !== 'paid';

    try {
      const response = await fetch(`/api/cars/${carId}/rental/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: item.dueDate, paid: nextPaid }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Не удалось обновить статус оплаты');
        return;
      }

      const data = (await response.json()) as { payment?: { paidAt: string | null } };
      const nextPaidAt = data.payment?.paidAt ?? (nextPaid ? new Date().toISOString() : null);
      const todayIso = new Date().toISOString().slice(0, 10);

      setItems((prev) =>
        prev.map((entry) => {
          if (entry.dueDate !== item.dueDate) return entry;
          const nextStatus: TimelineItem['status'] =
            nextPaidAt !== null ? 'paid' : entry.dueDate < todayIso ? 'overdue' : 'upcoming';
          return { ...entry, paidAt: nextPaidAt, status: nextStatus };
        }),
      );

      onUpdated();
    } catch {
      setError('Не удалось обновить оплату. Проверьте сеть');
    } finally {
      setPendingDueDate(null);
    }
  }

  return (
    <ModalShell
      title="Таймлайн оплаты аренды"
      headerMeta={
        rental ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{rental.renterName}</span>
            <span className="tabular-nums">
              {formatRub(rental.rateAmount)} / {PERIODICITY_SHORT[rental.periodicity]}
            </span>
            <span className="tabular-nums">с {formatDateRu(rental.startDate)}</span>
            {!rental.active && (
              <span
                style={{
                  backgroundColor: 'var(--status-available-bg)',
                  borderColor: 'var(--status-available-border)',
                  color: 'var(--status-available-text)',
                }}
                className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium"
              >
                Приостановлена
              </span>
            )}
          </div>
        ) : undefined
      }
      onClose={onClose}
      closeDisabled={pendingDueDate !== null}
      maxWidthClass="max-w-xl"
      zIndexClass="z-[60]"
    >
      {rental === null ? (
        <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
          Аренда для этой машины не настроена
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
          За последние 30 дней платежей по графику нет
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1 text-[var(--text-secondary)] tabular-nums">
              Платежей за 30 дн.: <strong className="text-[var(--text-primary)]">{items.length}</strong>
            </span>
            <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1 text-[var(--text-secondary)] tabular-nums">
              Оплачено: <strong className="text-[var(--text-primary)]">{paidCount}</strong>
            </span>
            {overdueCount > 0 && (
              <span
                style={{
                  backgroundColor: 'var(--status-overdue-bg)',
                  borderColor: 'var(--status-overdue-border)',
                  color: 'var(--status-overdue-text)',
                }}
                className="rounded-lg border px-2.5 py-1 font-medium tabular-nums"
              >
                Просрочено: {overdueCount}
              </span>
            )}
          </div>

          {error && (
            <p
              role="alert"
              style={{
                backgroundColor: 'var(--status-repair-bg)',
                borderColor: 'var(--status-repair-border)',
                color: 'var(--status-repair-text)',
              }}
              className="rounded-lg border px-3 py-2 text-xs font-medium"
            >
              {error}
            </p>
          )}

          <ul className="space-y-2">
            {items.map((item) => {
              const meta = TIMELINE_STATUS_META[item.status];
              const isOverdue = item.status === 'overdue';
              const isRowPending = pendingDueDate === item.dueDate;

              return (
                <li
                  key={item.dueDate}
                  data-status={item.status}
                  style={
                    isOverdue
                      ? {
                          backgroundColor: 'var(--status-overdue-bg)',
                          borderColor: 'var(--status-overdue-border)',
                          color: 'var(--status-overdue-text)',
                        }
                      : undefined
                  }
                  className={`flex flex-wrap items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 ${
                    isOverdue
                      ? ''
                      : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: meta.dotColor }}
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          {formatDateRu(item.dueDate)}
                        </span>
                        <span
                          style={meta.pillStyle}
                          className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4"
                        >
                          {meta.label}
                        </span>
                      </div>
                      {item.paidAt && (
                        <p className="mt-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
                          Оплачено {formatDateRu(item.paidAt)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex w-full items-center justify-between gap-2.5 sm:w-auto sm:shrink-0 sm:justify-end">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatRub(item.amount)}
                    </span>

                    {userRole === 'admin' && (
                      <button
                        type="button"
                        disabled={pendingDueDate !== null}
                        onClick={() => {
                          void handleTogglePayment(item);
                        }}
                        className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isRowPending
                          ? 'Сохранение...'
                          : item.status === 'paid'
                            ? 'Снять оплату'
                            : 'Отметить оплату'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </ModalShell>
  );
}
