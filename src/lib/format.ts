export const DAY_MS = 86_400_000;
const RU_NUMBER = new Intl.NumberFormat('ru-RU');
const ISO_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

function formatRuNumber(value: number): string {
  return RU_NUMBER.format(value).replace(/[\u00a0\u202f]/g, ' ');
}

/** Parse the calendar date prefix (`YYYY-MM-DD`) into a UTC midnight timestamp. */
export function parseUtcDateMs(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Format a UTC timestamp in milliseconds as `YYYY-MM-DD`. */
export function formatUtcDateIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Shift an ISO calendar date (`YYYY-MM-DD`) by `days` UTC days. */
export function shiftUtcDaysIso(isoDate: string, days: number): string {
  return formatUtcDateIso(parseUtcDateMs(isoDate) + days * DAY_MS);
}

/** Return signed whole UTC calendar days from `baseIso` to `targetIso`. */
export function diffUtcDays(targetIso: string, baseIso: string): number {
  return Math.round((parseUtcDateMs(targetIso) - parseUtcDateMs(baseIso)) / DAY_MS);
}

/** Format vehicle mileage in Russian convention (e.g. `142 500 км`). */
export function formatMileage(km: number): string {
  return `${formatRuNumber(km)} км`;
}

/** Format ruble amounts in Russian convention (e.g. `2 500 ₽`). */
export function formatRub(amount: number): string {
  return `${formatRuNumber(amount)} ₽`;
}

/** Format an ISO date or timestamp as `DD.MM.YYYY` without local TZ shifts. */
export function formatDateRu(iso: string): string {
  const match = ISO_PREFIX_RE.exec(iso.trim());
  if (match) {
    return `${match[3]}.${match[2]}.${match[1]}`;
  }
  const date = new Date(iso);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

/** Format an ISO timestamp as `DD.MM.YYYY, HH:mm` preserving its explicit offset. */
export function formatDateTimeRu(iso: string): string {
  const match = ISO_PREFIX_RE.exec(iso.trim());
  if (match && match[4] !== undefined && match[5] !== undefined) {
    return `${match[3]}.${match[2]}.${match[1]}, ${match[4]}:${match[5]}`;
  }
  const date = new Date(iso);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${date.getUTCFullYear()}, ${hh}:${min}`;
}

/** Compute remaining discount window state for a fine deadline relative to `todayIso`. */
export function getDiscountState(
  discountDeadline: string | null,
  todayIso: string,
): { active: boolean; daysLeft: number } {
  if (discountDeadline === null) {
    return { active: false, daysLeft: 0 };
  }
  const daysLeft = diffUtcDays(discountDeadline, todayIso);
  if (Number.isNaN(daysLeft) || daysLeft < 0) {
    return { active: false, daysLeft: 0 };
  }
  return { active: true, daysLeft };
}

/** Format a rental date range without fabricating an end date when `endDate` is null. */
export function formatRentalPeriod(
  startDate: string,
  endDate: string | null,
  active = false,
): string {
  const startLabel = formatDateRu(startDate);
  if (active) return `с ${startLabel} по настоящее время`;
  if (endDate) return `с ${startLabel} по ${formatDateRu(endDate)}`;
  return `с ${startLabel}`;
}
