import type { RentalPeriodicity } from '@/db/schema';
import { DAY_MS, formatUtcDateIso, parseUtcDateMs, shiftUtcDaysIso } from '@/lib/format';

export type TimelineItem = {
  dueDate: string;
  amount: number;
  status: 'paid' | 'overdue' | 'upcoming';
  paidAt: string | null;
};

export type RentalTimelineInput = {
  rateAmount: number;
  periodicity: RentalPeriodicity;
  startDate: string;
  endDate?: string | null;
  active?: boolean;
};

export type TimelinePaymentInput = {
  dueDate: string;
  amount: number;
  paidAt: string | null;
};

function parseUtcDate(isoDate: string): { year: number; month: number; day: number; ms: number } {
  const [y, m, d] = isoDate.split('-').map(Number);
  return { year: y, month: m - 1, day: d, ms: Date.UTC(y, m - 1, d) };
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
  return formatUtcDateIso(Date.UTC(year, month, Math.min(anchorDay, lastDay)));
}

function generateDueDates(
  startDate: string,
  periodicity: RentalPeriodicity,
  minDate: string,
  upperIso: string,
): string[] {
  const start = parseUtcDate(startDate);
  const dates: string[] = [];

  if (periodicity === 'daily' || periodicity === 'weekly') {
    const stepMs = (periodicity === 'daily' ? 1 : 7) * DAY_MS;
    const minMs = parseUtcDateMs(minDate);
    const upperMs = parseUtcDateMs(upperIso);
    const firstStep = minMs <= start.ms ? 0 : Math.ceil((minMs - start.ms) / stepMs);
    for (let ms = start.ms + firstStep * stepMs; ms <= upperMs; ms += stepMs) {
      dates.push(formatUtcDateIso(ms));
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
    if (due > upperIso) break;
    if (due >= minDate) dates.push(due);
  }
  return dates;
}

/** Build the 30-day inclusive rental payment timeline up to `min(todayIso, endDate)`. */
export function buildRentalTimeline(
  rental: RentalTimelineInput | null,
  payments: TimelinePaymentInput[],
  todayIso: string,
): TimelineItem[] {
  if (rental === null || rental.startDate > todayIso) return [];

  const windowStartIso = shiftUtcDaysIso(todayIso, -29);
  const minDate = rental.startDate > windowStartIso ? rental.startDate : windowStartIso;
  const endDate = rental.endDate && rental.endDate.length > 0 ? rental.endDate : null;
  const upperIso = endDate !== null && endDate < todayIso ? endDate : todayIso;
  if (upperIso < minDate) return [];

  const isClosedOnOrBeforeToday =
    rental.active === false && endDate !== null && endDate <= todayIso;
  const paymentByDue = new Map(payments.map((p) => [p.dueDate, p]));

  return generateDueDates(rental.startDate, rental.periodicity, minDate, upperIso).map((dueDate) => {
    const payment = paymentByDue.get(dueDate);
    const paidAt = payment?.paidAt ?? null;
    const status: TimelineItem['status'] =
      paidAt !== null
        ? 'paid'
        : isClosedOnOrBeforeToday || dueDate < todayIso
          ? 'overdue'
          : 'upcoming';

    return {
      dueDate,
      amount: payment?.amount ?? rental.rateAmount,
      status,
      paidAt,
    };
  });
}
