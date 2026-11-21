'use client';

import type { FineDto } from '@/lib/validation';
import { formatDateRu, formatDateTimeRu, formatRub } from '@/lib/format';
import { FineStatusPill, getFineDiscountMeta } from './FinesListModal';
import { ModalShell } from './ModalShell';

/** Detailed modal for a single fine showing resolution, timestamps, discount state, and deadlines. */
export function FineDetailModal({ fine, onClose }: { fine: FineDto; onClose: () => void }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const discountMeta = getFineDiscountMeta(fine, todayIso);

  return (
    <ModalShell
      title="Детали штрафа"
      headerMeta={<FineStatusPill status={fine.status} />}
      onClose={onClose}
      maxWidthClass="max-w-md"
      zIndexClass="z-[70]"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
          <p className="text-xs font-medium text-[var(--text-secondary)]">Нарушение</p>
          <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{fine.description}</p>
        </div>

        <dl className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm">
          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Номер постановления</dt>
            <dd className="font-mono text-xs font-semibold text-[var(--text-primary)] tabular-nums break-all sm:text-right sm:text-sm">
              {fine.resolutionNumber}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Дата и время нарушения</dt>
            <dd className="font-medium text-[var(--text-primary)] tabular-nums sm:text-right">
              {formatDateTimeRu(fine.violatedAt)}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <dt className="text-xs text-[var(--text-secondary)]">Сумма штрафа</dt>
            <dd className="font-semibold text-[var(--text-primary)] tabular-nums sm:text-right">
              {formatRub(fine.amount)}
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
                  <span
                    style={{ color: 'var(--status-repair-text)' }}
                    className="font-medium"
                  >
                    Скидка истекла
                  </span>
                  {fine.discountDeadline && (
                    <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                      Действовала до {formatDateRu(fine.discountDeadline)}
                    </span>
                  )}
                </span>
              )}

              {discountMeta.kind === 'active' && (
                <span className="flex flex-col sm:items-end">
                  {fine.discountAmount !== null && (
                    <span
                      style={{ color: 'var(--status-rent-text)' }}
                      className="font-semibold tabular-nums"
                    >
                      {formatRub(fine.discountAmount)}
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                    {fine.discountAmount !== null ? 'до' : 'Действует до'}{' '}
                    {formatDateRu(fine.discountDeadline!)}
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
              {formatDateRu(fine.paymentDeadline)}
            </dd>
          </div>
        </dl>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] sm:w-auto"
          >
            Закрыть
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
