'use client';

import type { MaintenanceDto } from '@/lib/validation';
import { formatDateRu, formatMileage, formatRub } from '@/lib/format';
import { ModalShell } from './ModalShell';

/** Detailed maintenance record modal with date, mileage, parts table, labor cost, and total. */
export function ServiceDetailModal({
  record,
  onClose,
}: {
  record: MaintenanceDto;
  onClose: () => void;
}) {
  return (
    <ModalShell
      title="Детали ремонта"
      onClose={onClose}
      maxWidthClass="max-w-xl"
      zIndexClass="z-[70]"
    >
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{record.title}</h3>

        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 text-sm">
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">Дата ремонта</dt>
            <dd className="mt-0.5 font-medium text-[var(--text-primary)] tabular-nums">
              {formatDateRu(record.performedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">Пробег</dt>
            <dd className="mt-0.5 font-medium text-[var(--text-primary)] tabular-nums">
              {formatMileage(record.mileage)}
            </dd>
          </div>
        </dl>

        {record.notes && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
            <p className="text-xs font-medium text-[var(--text-secondary)]">Примечание</p>
            <p className="mt-1 text-sm text-[var(--text-primary)]">{record.notes}</p>
          </div>
        )}

        <div>
          <h4 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
            Запчасти и материалы
          </h4>
          {record.parts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-3.5 py-4 text-center text-xs text-[var(--text-secondary)]">
              Запчасти не указаны
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              <table className="w-full border-collapse text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                    <th className="px-2.5 py-2 font-medium whitespace-nowrap sm:px-3">Название</th>
                    <th className="px-2.5 py-2 font-medium whitespace-nowrap sm:px-3">Артикул</th>
                    <th className="px-2.5 py-2 text-right font-medium whitespace-nowrap sm:px-3">Кол-во</th>
                    <th className="px-2.5 py-2 text-right font-medium whitespace-nowrap sm:px-3">Цена</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {record.parts.map((part) => (
                    <tr key={part.id} className="text-[var(--text-primary)]">
                      <td className="px-2.5 py-2 font-medium sm:px-3">{part.name}</td>
                      <td className="px-2.5 py-2 font-mono text-xs text-[var(--text-secondary)] tabular-nums sm:px-3">
                        {part.sku?.trim() ? part.sku : '—'}
                      </td>
                      <td className="px-2.5 py-2 text-right tabular-nums sm:px-3">{part.quantity}</td>
                      <td className="px-2.5 py-2 text-right font-medium whitespace-nowrap tabular-nums sm:px-3">
                        {formatRub(part.unitPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <dl className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[var(--text-secondary)]">Стоимость работ</dt>
            <dd className="font-medium text-[var(--text-primary)] tabular-nums">
              {formatRub(record.laborCost)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] pt-2">
            <dt className="font-semibold text-[var(--text-primary)]">Итого</dt>
            <dd className="text-base font-semibold text-[var(--text-primary)] tabular-nums">
              {formatRub(record.totalCost)}
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
