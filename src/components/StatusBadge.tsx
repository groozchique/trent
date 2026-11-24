import type { CSSProperties } from 'react';
import type { CarStatus } from '@/db/schema';

const STATUS_META: Record<
  CarStatus,
  {
    label: string;
    badgeStyle: CSSProperties;
  }
> = {
  in_rent: {
    label: 'В аренде',
    badgeStyle: {
      backgroundColor: 'var(--status-rent-bg)',
      borderColor: 'var(--status-rent-border)',
      color: 'var(--status-rent-text)',
    },
  },
  in_repair: {
    label: 'На ремонте',
    badgeStyle: {
      backgroundColor: 'var(--status-repair-bg)',
      borderColor: 'var(--status-repair-border)',
      color: 'var(--status-repair-text)',
    },
  },
  available: {
    label: 'Не в аренде',
    badgeStyle: {
      backgroundColor: 'var(--status-available-bg)',
      borderColor: 'var(--status-available-border)',
      color: 'var(--status-available-text)',
    },
  },
};

/** High-contrast Russian status pill for fleet cars in light and dark modes. */
export function StatusBadge({
  status,
  className,
}: {
  status: CarStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];

  return (
    <span
      data-status={status}
      style={meta.badgeStyle}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap ${className ?? ''}`.trim()}
    >
      <span>{meta.label}</span>
    </span>
  );
}
