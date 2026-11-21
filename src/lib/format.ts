const DAY_MS = 86_400_000;
const RU_NUMBER = new Intl.NumberFormat('ru-RU');
const ISO_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

function formatRuNumber(value: number): string {
  return RU_NUMBER.format(value).replace(/[\u00a0\u202f]/g, ' ');
}

function parseUtcDateMs(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
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
  const deadlineMs = parseUtcDateMs(discountDeadline);
  const todayMs = parseUtcDateMs(todayIso);
  if (Number.isNaN(deadlineMs) || Number.isNaN(todayMs) || todayMs > deadlineMs) {
    return { active: false, daysLeft: 0 };
  }
  const daysLeft = Math.round((deadlineMs - todayMs) / DAY_MS);
  return { active: true, daysLeft };
}
