import type { RentalPeriodicity } from '@/db/schema';

export type TimelineItem = {
  dueDate: string;
  amount: number;
  status: 'paid' | 'overdue' | 'upcoming';
  paidAt: string | null;
};

const DAY_MS = 86_400_000;

function parseUtcDate(isoDate: string): { year: number; month: number; day: number; ms: number } {
  const [y, m, d] = isoDate.split('-').map(Number);
  return { year: y, month: m - 1, day: d, ms: Date.UTC(y, m - 1, d) };
}

function formatUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addMonthlyClamped(
  startYear: number,
  startMonth: number,
  anchorDay: number,
  offset: number,
): string {
  const totalMonths = startYear * 12 + startMonth + offset;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatUtcMs(Date.UTC(year, month, Math.min(anchorDay, lastDay)));
}

function generateDueDates(
  startDate: string,
  periodicity: RentalPeriodicity,
  minDate: string,
  todayIso: string,
): string[] {
  const start = parseUtcDate(startDate);
  const dates: string[] = [];

  if (periodicity === 'daily' || periodicity === 'weekly') {
    const stepMs = (periodicity === 'daily' ? 1 : 7) * DAY_MS;
    const minMs = parseUtcDate(minDate).ms;
    const todayMs = parseUtcDate(todayIso).ms;
    const firstStep = minMs <= start.ms ? 0 : Math.ceil((minMs - start.ms) / stepMs);
    for (let ms = start.ms + firstStep * stepMs; ms <= todayMs; ms += stepMs) {
      dates.push(formatUtcMs(ms));
    }
    return dates;
  }

  const minParsed = parseUtcDate(minDate);
  const startOffset = Math.max(
    0,
    (minParsed.year - start.year) * 12 + (minParsed.month - start.month) - 1,
  );
  for (let offset = startOffset; ; offset += 1) {
    const due = addMonthlyClamped(start.year, start.month, start.day, offset);
    if (due > todayIso) break;
    if (due >= minDate) dates.push(due);
  }
  return dates;
}

/** Build the 30-day inclusive rental payment timeline up to `todayIso`. */
export function buildRentalTimeline(
  rental: { rateAmount: number; periodicity: RentalPeriodicity; startDate: string } | null,
  payments: Array<{ dueDate: string; amount: number; paidAt: string | null }>,
  todayIso: string,
): TimelineItem[] {
  if (rental === null || rental.startDate > todayIso) return [];

  const windowStartIso = formatUtcMs(parseUtcDate(todayIso).ms - 29 * DAY_MS);
  const minDate = rental.startDate > windowStartIso ? rental.startDate : windowStartIso;
  const paymentByDue = new Map(payments.map((p) => [p.dueDate, p]));

  return generateDueDates(rental.startDate, rental.periodicity, minDate, todayIso).map((dueDate) => {
    const payment = paymentByDue.get(dueDate);
    const paidAt = payment?.paidAt ?? null;
    const status: TimelineItem['status'] =
      paidAt !== null ? 'paid' : dueDate < todayIso ? 'overdue' : 'upcoming';

    return {
      dueDate,
      amount: payment?.amount ?? rental.rateAmount,
      status,
      paidAt,
    };
  });
}
