'use client';

import type { CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import type { FineDto } from '@/lib/validation';
import { formatDateRu, formatDateTimeRu, formatRub, getDiscountState } from '@/lib/format';
import { ModalShell } from './ModalShell';

const FINE_STATUS_META: Record<FineDto['status'], { label: string; style: CSSProperties }> = {
  paid: {
    label: 'Оплачен',
    style: {
      backgroundColor: 'var(--status-rent-bg)',
      borderColor: 'var(--status-rent-border)',
      color: 'var(--status-rent-text)',
    },
  },
  unpaid: {
    label: 'Не оплачен',
    style: {
      backgroundColor: 'var(--status-repair-bg)',
      borderColor: 'var(--status-repair-border)',
      color: 'var(--status-repair-text)',
    },
  },
};

export type FineDiscountMeta =
  | { kind: 'none'; label: string; daysLeft: 0 }
  | { kind: 'expired'; label: string; daysLeft: 0; deadline: string }
  | { kind: 'active'; label: string; daysLeft: number; deadline: string };

/** Compute human-readable Russian discount state without negative remaining days. */
export function getFineDiscountMeta(fine: FineDto, todayIso: string): FineDiscountMeta {
  if (fine.discountDeadline === null) {
    return { kind: 'none', label: 'Без скидки', daysLeft: 0 };
  }
  const discount = getDiscountState(fine.discountDeadline, todayIso);
  if (!discount.active) {
    return {
      kind: 'expired',
      label: 'Скидка истекла',
      daysLeft: 0,
      deadline: fine.discountDeadline,
    };
  }
  const deadlineLabel = formatDateRu(fine.discountDeadline);
  if (fine.discountAmount !== null) {
    return {
      kind: 'active',
      label: `Со скидкой ${formatRub(fine.discountAmount)} до ${deadlineLabel}`,
      daysLeft: discount.daysLeft,
      deadline: fine.discountDeadline,
    };
  }
  return {
    kind: 'active',
    label: `Скидка до ${deadlineLabel}`,
    daysLeft: discount.daysLeft,
    deadline: fine.discountDeadline,
  };
}

/** Shared status pill for paid/unpaid fines. */
export function FineStatusPill({ status }: { status: FineDto['status'] }) {
  const meta = FINE_STATUS_META[status];
  return (
    <span
      style={meta.style}
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap"
    >
      {meta.label}
    </span>
  );
}

/** Clickable fine summary row shared by CarDetailModal and FinesListModal. */
export function FineListRow({
  fine,
  todayIso,
  onSelect,
}: {
  fine: FineDto;
  todayIso: string;
  onSelect: (fine: FineDto) => void;
}) {
  const discountMeta = getFineDiscountMeta(fine, todayIso);

  return (
    <button
      type="button"
      onClick={() => onSelect(fine)}
      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--text-primary)]">
          {fine.description}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--text-secondary)]">
          <span className="tabular-nums">{formatDateTimeRu(fine.violatedAt)}</span>
          <span
            style={
              discountMeta.kind === 'active' && fine.status === 'unpaid'
                ? { color: 'var(--status-rent-text)' }
                : undefined
            }
            className="tabular-nums"
          >
            {discountMeta.label}
          </span>
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <span className="flex flex-col items-end gap-1 text-right">
          <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
            {formatRub(fine.amount)}
          </span>
          <FineStatusPill status={fine.status} />
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
      </span>
    </button>
  );
}

/** Modal displaying all fines of a car with row selection into FineDetailModal. */
export function FinesListModal({
  fines,
  onSelectFine,
  onClose,
}: {
  fines: FineDto[];
  onSelectFine: (fine: FineDto) => void;
  onClose: () => void;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <ModalShell
      title={`Все штрафы (${fines.length})`}
      onClose={onClose}
      maxWidthClass="max-w-xl"
      zIndexClass="z-[60]"
    >
      {fines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
          Штрафов нет
        </p>
      ) : (
        <ul className="space-y-2">
          {fines.map((fine) => (
            <li key={fine.id}>
              <FineListRow fine={fine} todayIso={todayIso} onSelect={onSelectFine} />
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
