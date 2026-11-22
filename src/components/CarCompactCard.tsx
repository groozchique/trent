'use client';

import { User } from 'lucide-react';
import type { CarSummaryDto } from '@/lib/validation';
import { formatMileage } from '@/lib/format';
import { BrandIcon } from './BrandIcon';
import { StatusBadge } from './StatusBadge';

/** Compact clickable fleet car tile displaying driver, mileage, fines, and urgent deadline status. */
export function CarCompactCard({
  car,
  onSelect,
}: {
  car: CarSummaryDto;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(car.id)}
      className="flex w-full cursor-pointer flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/45 active:bg-[var(--bg-elevated)]"
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center truncate rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-sm font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
          {car.plate}
        </span>
        <StatusBadge status={car.status} className="shrink-0" />
      </span>

      <span className="mt-3 flex w-full min-w-0 items-center gap-2">
        <BrandIcon
          brand={car.brand}
          className="h-5 w-5 shrink-0 text-[var(--text-secondary)]"
        />
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
          {car.brand} {car.model}
        </span>
      </span>

      {car.activeDriverName && (
        <span className="mt-1.5 flex w-full min-w-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{car.activeDriverName}</span>
        </span>
      )}

      <span className="mt-3.5 flex w-full flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-3 text-xs">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-secondary)]">Пробег</span>
          <span className="font-medium text-[var(--text-primary)] tabular-nums">
            {formatMileage(car.mileage)}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-secondary)]">Неоплаченные штрафы</span>
          {car.unpaidFinesCount > 0 ? (
            <span
              style={{
                backgroundColor: 'var(--status-repair-bg)',
                borderColor: 'var(--status-repair-border)',
                color: 'var(--status-repair-text)',
              }}
              className="inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums"
            >
              {car.unpaidFinesCount}
            </span>
          ) : (
            <span className="font-medium text-[var(--text-secondary)] tabular-nums">0</span>
          )}
        </span>
        {car.deadlineStatus !== 'ok' && (
          <span className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[var(--text-secondary)]">Сроки</span>
            <span
              data-deadline-status={car.deadlineStatus}
              style={
                car.deadlineStatus === 'expired'
                  ? {
                      backgroundColor: 'var(--status-repair-bg)',
                      borderColor: 'var(--status-repair-border)',
                      color: 'var(--status-repair-text)',
                    }
                  : {
                      backgroundColor: 'var(--status-overdue-bg)',
                      borderColor: 'var(--status-overdue-border)',
                      color: 'var(--status-overdue-text)',
                    }
              }
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums"
            >
              {car.deadlineStatus === 'expired'
                ? `Просрочено сроков: ${car.urgentDeadlinesCount}`
                : `Истекают сроки: ${car.urgentDeadlinesCount}`}
            </span>
          </span>
        )}
      </span>
    </button>
  );
}
