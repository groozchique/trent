'use client';

import { ChevronRight } from 'lucide-react';
import type { MaintenanceDto } from '@/lib/validation';
import { formatDateRu, formatMileage, formatRub } from '@/lib/format';
import { ModalShell } from './ModalShell';

/** Modal listing maintenance and repair events for a car. */
export function ServiceHistoryModal({
  records,
  onSelectRecord,
  onClose,
}: {
  records: MaintenanceDto[];
  onSelectRecord: (record: MaintenanceDto) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell
      title="История ремонта"
      onClose={onClose}
      maxWidthClass="max-w-xl"
      zIndexClass="z-[60]"
    >
      {records.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
          Записей о ремонте и ТО пока нет
        </p>
      ) : (
        <ul className="space-y-2">
          {records.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => onSelectRecord(record)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {record.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
                    <span>{formatDateRu(record.performedAt)}</span>
                    <span>{formatMileage(record.mileage)}</span>
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                    {formatRub(record.totalCost)}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
                    aria-hidden="true"
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
