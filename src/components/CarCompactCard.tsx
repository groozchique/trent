'use client';

import type { CSSProperties } from 'react';
import { User } from 'lucide-react';
import type { CarSummaryDto, DeadlineState } from '@/lib/validation';
import { SHOW_FINES } from '@/lib/features';
import { formatMileage } from '@/lib/format';
import { BrandIcon } from './BrandIcon';
import { StatusBadge } from './StatusBadge';

const DEADLINE_BADGE_MAP: Record<
  DeadlineState,
  {
    style: CSSProperties;
    label: (count: number) => string;
  }
> = {
  ok: {
    style: {
      backgroundColor: 'var(--status-rent-bg)',
      borderColor: 'var(--status-rent-border)',
      color: 'var(--status-rent-text)',
    },
    label: () => 'Всё в норме',
  },
  warning: {
    style: {
      backgroundColor: 'var(--status-overdue-bg)',
      borderColor: 'var(--status-overdue-border)',
      color: 'var(--status-overdue-text)',
    },
    label: (count) => `Истекают сроки: ${count}`,
  },
  expired: {
    style: {
      backgroundColor: 'var(--status-repair-bg)',
      borderColor: 'var(--status-repair-border)',
      color: 'var(--status-repair-text)',
    },
    label: (count) => `Просрочено сроков: ${count}`,
  },
};

/** Compact clickable fleet car tile displaying fixed driver, mileage, fines, and deadline rows. */
export function CarCompactCard({
  car,
  onSelect,
}: {
  car: CarSummaryDto;
  onSelect: (id: number) => void;
}) {
  const deadlineBadge = DEADLINE_BADGE_MAP[car.deadlineStatus];

  return (
    <button
      type="button"
      onClick={() => onSelect(car.id)}
      className="flex h-full w-full cursor-pointer flex-col justify-between gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]/45 active:bg-[var(--bg-elevated)]"
    >
      <span className="flex w-full flex-col">
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

        <span className="mt-2 flex w-full min-w-0 items-center gap-2 text-xs text-[var(--text-muted)]">
          <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {car.activeDriverName ? (
            <span className="min-w-0 truncate text-[var(--text-secondary)]">
              {car.activeDriverName}
            </span>
          ) : (
            <span className="min-w-0 truncate text-[var(--text-muted)]">Нет арендатора</span>
          )}
        </span>
      </span>

      <span className="flex w-full flex-col gap-2 border-t border-[var(--border-subtle)] pt-3 text-xs">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-secondary)]">Пробег</span>
          <span className="font-medium text-[var(--text-primary)] tabular-nums">
            {formatMileage(car.mileage)}
          </span>
        </span>
        {SHOW_FINES && (
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
        )}
        <span className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-secondary)]">Сроки</span>
          <span
            data-deadline-status={car.deadlineStatus}
            style={deadlineBadge.style}
            className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-4 tabular-nums"
          >
            {deadlineBadge.label(car.urgentDeadlinesCount)}
          </span>
        </span>
      </span>
    </button>
  );
}
