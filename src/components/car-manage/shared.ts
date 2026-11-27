import type { FineDto } from '@/lib/validation';

export const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] disabled:opacity-60';

export const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-[var(--text-secondary)]';

export const PRIMARY_BTN_CLASS =
  'inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

export const SECONDARY_BTN_CLASS =
  'inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50';

export function parseRequiredNumber(raw: string): number {
  const trimmed = raw.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

export function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : Number(trimmed);
}

export function toPreviewInt(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function summarizeFines(items: FineDto[]): {
  unpaidFinesCount: number;
  unpaidFinesSum: number;
} {
  let unpaidFinesCount = 0;
  let unpaidFinesSum = 0;
  for (const item of items) {
    if (item.status === 'unpaid') {
      unpaidFinesCount += 1;
      unpaidFinesSum += item.amount;
    }
  }
  return { unpaidFinesCount, unpaidFinesSum };
}
