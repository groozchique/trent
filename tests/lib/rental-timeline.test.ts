import { describe, it, expect } from 'vitest';
import { buildRentalTimeline } from '@/lib/rental/timeline';
import {
  formatDateRu,
  formatDateTimeRu,
  formatMileage,
  formatRub,
  getDiscountState,
} from '@/lib/format';

describe('buildRentalTimeline', () => {
  it('returns empty array when rental is null', () => {
    expect(buildRentalTimeline(null, [], '2026-11-21')).toEqual([]);
  });

  it('marks unpaid past due dates in last 30 days as overdue and paid as paid', () => {
    const items = buildRentalTimeline(
      { rateAmount: 2200, periodicity: 'weekly', startDate: '2026-10-25' },
      [{ dueDate: '2026-11-01', amount: 2200, paidAt: '2026-11-01T10:00:00Z' }],
      '2026-11-21',
    );
    expect(items.map((i) => [i.dueDate, i.status])).toEqual([
      ['2026-10-25', 'overdue'],
      ['2026-11-01', 'paid'],
      ['2026-11-08', 'overdue'],
      ['2026-11-15', 'overdue'],
    ]);
  });

  it('marks unpaid due date equal to todayIso as upcoming and uses payment.amount override', () => {
    const items = buildRentalTimeline(
      { rateAmount: 2200, periodicity: 'weekly', startDate: '2026-10-31' },
      [
        { dueDate: '2026-11-07', amount: 2500, paidAt: '2026-11-07T09:00:00Z' },
        { dueDate: '2026-11-21', amount: 1800, paidAt: null },
      ],
      '2026-11-21',
    );
    expect(items).toEqual([
      { dueDate: '2026-10-31', amount: 2200, status: 'overdue', paidAt: null },
      { dueDate: '2026-11-07', amount: 2500, status: 'paid', paidAt: '2026-11-07T09:00:00Z' },
      { dueDate: '2026-11-14', amount: 2200, status: 'overdue', paidAt: null },
      { dueDate: '2026-11-21', amount: 1800, status: 'upcoming', paidAt: null },
    ]);
  });

  it('bounds daily schedule to inclusive [today - 29 days, today] window', () => {
    const items = buildRentalTimeline(
      { rateAmount: 2000, periodicity: 'daily', startDate: '2026-09-01' },
      [{ dueDate: '2026-11-21', amount: 2000, paidAt: '2026-11-21T08:00:00Z' }],
      '2026-11-21',
    );
    expect(items).toHaveLength(30);
    expect(items[0]).toEqual({
      dueDate: '2026-10-23',
      amount: 2000,
      status: 'overdue',
      paidAt: null,
    });
    expect(items[29]).toEqual({
      dueDate: '2026-11-21',
      amount: 2000,
      status: 'paid',
      paidAt: '2026-11-21T08:00:00Z',
    });
  });

  it('clamps monthly startDate on 31st to Feb 28 and restores 31st in March', () => {
    const febItems = buildRentalTimeline(
      { rateAmount: 45000, periodicity: 'monthly', startDate: '2026-01-31' },
      [],
      '2026-03-05',
    );
    expect(febItems.map((i) => i.dueDate)).toEqual(['2026-02-28']);

    const marItems = buildRentalTimeline(
      { rateAmount: 45000, periodicity: 'monthly', startDate: '2026-01-31' },
      [],
      '2026-03-31',
    );
    expect(marItems.map((i) => [i.dueDate, i.status])).toEqual([
      ['2026-03-31', 'upcoming'],
    ]);
  });

  it('clamps monthly startDate on 31st to Feb 29 in leap year and restores 31st in March', () => {
    const leapItems = buildRentalTimeline(
      { rateAmount: 45000, periodicity: 'monthly', startDate: '2024-01-31' },
      [],
      '2024-03-29',
    );
    expect(leapItems.map((i) => i.dueDate)).toEqual(['2024-02-29']);

    const leapMarItems = buildRentalTimeline(
      { rateAmount: 45000, periodicity: 'monthly', startDate: '2024-01-31' },
      [],
      '2024-03-31',
    );
    expect(leapMarItems.map((i) => [i.dueDate, i.status])).toEqual([
      ['2024-03-31', 'upcoming'],
    ]);
  });

  it('returns empty array when startDate is in the future', () => {
    const futureItems = buildRentalTimeline(
      { rateAmount: 2000, periodicity: 'daily', startDate: '2026-11-25' },
      [],
      '2026-11-21',
    );
    expect(futureItems).toEqual([]);
  });

  it('marks unpaid dueDate === endDate === todayIso as overdue for closed rentals and stops after endDate', () => {
    const closedToday = buildRentalTimeline(
      {
        rateAmount: 2200,
        periodicity: 'daily',
        startDate: '2026-11-19',
        endDate: '2026-11-21',
        active: false,
      },
      [{ dueDate: '2026-11-19', amount: 2200, paidAt: '2026-11-19T10:00:00Z' }],
      '2026-11-21',
    );
    expect(closedToday.map((i) => [i.dueDate, i.status])).toEqual([
      ['2026-11-19', 'paid'],
      ['2026-11-20', 'overdue'],
      ['2026-11-21', 'overdue'],
    ]);

    const openToday = buildRentalTimeline(
      {
        rateAmount: 2200,
        periodicity: 'daily',
        startDate: '2026-11-19',
        endDate: null,
        active: true,
      },
      [{ dueDate: '2026-11-19', amount: 2200, paidAt: '2026-11-19T10:00:00Z' }],
      '2026-11-21',
    );
    expect(openToday.map((i) => [i.dueDate, i.status])).toEqual([
      ['2026-11-19', 'paid'],
      ['2026-11-20', 'overdue'],
      ['2026-11-21', 'upcoming'],
    ]);

    const closedEarlier = buildRentalTimeline(
      {
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: '2026-11-12',
        endDate: '2026-11-16',
        active: false,
      },
      [{ dueDate: '2026-11-12', amount: 2000, paidAt: '2026-11-12T08:00:00Z' }],
      '2026-11-21',
    );
    expect(closedEarlier.map((i) => [i.dueDate, i.status])).toEqual([
      ['2026-11-12', 'paid'],
      ['2026-11-13', 'overdue'],
      ['2026-11-14', 'overdue'],
      ['2026-11-15', 'overdue'],
      ['2026-11-16', 'overdue'],
    ]);

    const closedBeforeWindow = buildRentalTimeline(
      {
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: '2026-10-01',
        endDate: '2026-10-22',
        active: false,
      },
      [],
      '2026-11-21',
    );
    expect(closedBeforeWindow).toEqual([]);
  });
});

describe('formatters and discount state', () => {
  it('formats mileage and rubles with regular ASCII spaces', () => {
    expect(formatMileage(142500)).toBe('142 500 км');
    expect(formatMileage(0)).toBe('0 км');
    expect(formatRub(2500)).toBe('2 500 ₽');
    expect(formatRub(750)).toBe('750 ₽');
    expect(formatRub(1250000)).toBe('1 250 000 ₽');
  });

  it('formats Russian dates and datetimes without timezone shift bugs', () => {
    expect(formatDateRu('2026-11-21')).toBe('21.11.2026');
    expect(formatDateRu('2026-01-05T23:45:00+03:00')).toBe('05.01.2026');
    expect(formatDateTimeRu('2026-11-18T14:20:00+03:00')).toBe('18.11.2026, 14:20');
    expect(formatDateTimeRu('2026-11-01T10:00:00Z')).toBe('01.11.2026, 10:00');
  });

  it('computes fine discount state against todayIso', () => {
    expect(getDiscountState(null, '2026-11-21')).toEqual({ active: false, daysLeft: 0 });
    expect(getDiscountState('2026-11-20', '2026-11-21')).toEqual({ active: false, daysLeft: 0 });
    expect(getDiscountState('2026-11-21', '2026-11-21')).toEqual({ active: true, daysLeft: 0 });
    expect(getDiscountState('2026-11-25', '2026-11-21')).toEqual({ active: true, daysLeft: 4 });
    expect(getDiscountState('2026-11-21T12:00:00Z', '2026-11-21')).toEqual({ active: true, daysLeft: 0 });
    expect(getDiscountState('2026-11-20T23:59:59Z', '2026-11-21')).toEqual({ active: false, daysLeft: 0 });
    expect(getDiscountState('invalid-date', '2026-11-21')).toEqual({ active: false, daysLeft: 0 });
  });
});
