'use client';

import { useEffect, useState } from 'react';
import type { UserRole } from '@/db/schema';
import type { FineDto } from '@/lib/validation';
import { formatDateRu, formatDateTimeRu, formatRub } from '@/lib/format';
import { FineStatusPill, getFineDiscountMeta } from './FinesListModal';
import { ModalShell } from './ModalShell';

/** Detailed modal for a single fine with resolution, timestamps, driver, discount state, and admin status toggle. */
export function FineDetailModal({
  fine,
  carId,
  userRole = 'viewer',
  onClose,
  onUpdated,
}: {
  fine: FineDto;
  carId?: number;
  userRole?: UserRole;
  onClose: () => void;
  onUpdated?: (updatedFine: FineDto) => void;
}) {
  const [currentFine, setCurrentFine] = useState<FineDto>(fine);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentFine(fine);
    setError(null);
  }, [fine]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const discountMeta = getFineDiscountMeta(currentFine, todayIso);

  async function handleToggleStatus() {
    if (pending) return;
    const targetCarId = carId ?? currentFine.carId;
    const nextStatus: FineDto['status'] = currentFine.status === 'paid' ? 'unpaid' : 'paid';
    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/cars/${targetCarId}/fines/${currentFine.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Не удалось обновить статус штрафа');
        return;
      }

      const data = (await response.json().catch(() => null)) as { fine?: FineDto } | null;
      const updatedFine = data?.fine ?? { ...currentFine, status: nextStatus };
      setCurrentFine(updatedFine);
      onUpdated?.(updatedFine);
    } catch {
      setError('Не удалось обновить статус. Проверьте сеть');
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalShell
      title="Детали штрафа"
      headerMeta={<FineStatusPill status={currentFine.status} />}
      onClose={onClose}
      closeDisabled={pending}
      maxWidthClass="max-w-md"
      zIndexClass="z-[70]"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
          <p className="text-xs font-medium text-[var(--text-secondary)]">Нарушение</p>
          <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">
            {currentFine.description}
          </p>
        </div>

        <dl className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm">
          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Номер постановления</dt>
            <dd className="font-mono text-xs font-semibold text-[var(--text-primary)] tabular-nums break-all sm:text-right sm:text-sm">
              {currentFine.resolutionNumber}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Водитель</dt>
            <dd className="font-medium text-[var(--text-primary)] sm:text-right">
              {currentFine.driverName ?? 'Не определён'}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Дата и время нарушения</dt>
            <dd className="font-medium text-[var(--text-primary)] tabular-nums sm:text-right">
              {formatDateTimeRu(currentFine.violatedAt)}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Сумма штрафа</dt>
            <dd className="font-semibold text-[var(--text-primary)] tabular-nums sm:text-right">
              {formatRub(currentFine.amount)}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Оплата со скидкой</dt>
            <dd className="sm:text-right">
              {discountMeta.kind === 'none' && (
                <span className="font-medium text-[var(--text-secondary)]">Без скидки</span>
              )}

              {discountMeta.kind === 'expired' && (
                <span className="flex flex-col sm:items-end">
                  <span style={{ color: 'var(--status-repair-text)' }} className="font-medium">
                    Скидка истекла
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                    Действовала до {formatDateRu(discountMeta.deadline)}
                  </span>
                </span>
              )}

              {discountMeta.kind === 'active' && (
                <span className="flex flex-col sm:items-end">
                  {currentFine.discountAmount !== null && (
                    <span
                      style={{ color: 'var(--status-rent-text)' }}
                      className="font-semibold tabular-nums"
                    >
                      {formatRub(currentFine.discountAmount)}
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                    {currentFine.discountAmount !== null ? 'до' : 'Действует до'}{' '}
                    {formatDateRu(discountMeta.deadline)}
                    {discountMeta.daysLeft === 0
                      ? ' (сегодня последний день)'
                      : ` (осталось ${discountMeta.daysLeft} дн.)`}
                  </span>
                </span>
              )}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Крайний срок оплаты</dt>
            <dd className="font-medium text-[var(--text-primary)] tabular-nums sm:text-right">
              {formatDateRu(currentFine.paymentDeadline)}
            </dd>
          </div>
        </dl>

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

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Закрыть
          </button>

          {userRole === 'admin' && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                void handleToggleStatus();
              }}
              className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {pending
                ? 'Сохранение...'
                : currentFine.status === 'paid'
                  ? 'Вернуть в неоплаченные'
                  : 'Отметить оплаченным'}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}