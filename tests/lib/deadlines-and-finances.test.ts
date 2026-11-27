import { describe, expect, it } from 'vitest';
import type { CarDocumentRow } from '@/db/schema';
import {
  CAR_DOCUMENT_LABELS,
  evaluateCarDeadlines,
  evaluateDateDeadline,
  evaluateMileageDeadline,
} from '@/lib/deadlines';
import {
  computeCarFinances,
  computeFleetFinancialSummary,
  computeManagerFee,
  computeRentDebt30d,
  getMonthStartIso,
  getWindowStartIso,
  sumPaidAndManagerInRange,
} from '@/lib/finances';
import { getTodayIso } from '@/lib/format';
import {
  createCarSchema,
  createDriverSchema,
  createFineSchema,
  createUserSchema,
  endRentalSchema,
  updateCarSchema,
  updateDriverSchema,
  updateFineStatusSchema,
  updateUserSchema,
  upsertDocumentsSchema,
  upsertRentalSchema,
  type CarSummaryDto,
} from '@/lib/validation';

function expectRussianValidationError(result: { success: boolean; error?: { issues: Array<{ message: string }> } }) {
  expect(result.success).toBe(false);
  if (!result.success) {
    const msg = result.error?.issues[0]?.message ?? '';
    expect(msg).toMatch(/[А-Яа-яЁё]/);
    expect(msg).not.toMatch(/invalid input|expected/i);
  }
}

describe('deadlines engine', () => {
  it('evaluates date deadline thresholds (-1d expired, 0d..14d warning, 15d ok)', () => {
    expect(evaluateDateDeadline('2026-11-20', '2026-11-21')).toEqual({
      status: 'expired',
      daysLeft: -1,
    });
    expect(evaluateDateDeadline('2026-11-21', '2026-11-21')).toEqual({
      status: 'warning',
      daysLeft: 0,
    });
    expect(evaluateDateDeadline('2026-12-05', '2026-11-21')).toEqual({
      status: 'warning',
      daysLeft: 14,
    });
    expect(evaluateDateDeadline('2026-12-06', '2026-11-21')).toEqual({
      status: 'ok',
      daysLeft: 15,
    });
  });

  it('evaluates mileage deadline thresholds (<=0 expired, 1..1000 warning, >1000 ok)', () => {
    expect(evaluateMileageDeadline(150500, 150000)).toEqual({
      status: 'expired',
      mileageLeft: -500,
    });
    expect(evaluateMileageDeadline(150000, 150000)).toEqual({
      status: 'expired',
      mileageLeft: 0,
    });
    expect(evaluateMileageDeadline(149000, 150000)).toEqual({
      status: 'warning',
      mileageLeft: 1000,
    });
    expect(evaluateMileageDeadline(148999, 150000)).toEqual({
      status: 'ok',
      mileageLeft: 1001,
    });
  });

  it('aggregates worst status and urgent count across documents and planned service', () => {
    expect(CAR_DOCUMENT_LABELS).toEqual({
      osago: 'ОСАГО',
      tech_inspection: 'Техосмотр',
      taxi_license: 'Лицензия такси',
      kasko: 'КАСКО',
    });

    const empty = evaluateCarDeadlines(
      { mileage: 50000, nextServiceMileage: null, nextServiceDate: null },
      [],
      '2026-11-21',
    );
    expect(empty.status).toBe('ok');
    expect(empty.urgentDeadlinesCount).toBe(0);

    const docs: CarDocumentRow[] = [
      { id: 1, carId: 1, type: 'kasko', expiresAt: '2026-12-20', policyNumber: null, notes: null },
      { id: 2, carId: 1, type: 'osago', expiresAt: '2026-11-20', policyNumber: 'XXX 123', notes: null },
      { id: 3, carId: 1, type: 'tech_inspection', expiresAt: '2026-12-05', policyNumber: null, notes: null },
    ];

    const summary = evaluateCarDeadlines(
      { mileage: 149500, nextServiceMileage: 150000, nextServiceDate: '2026-12-10' },
      docs,
      '2026-11-21',
    );
    expect(summary.status).toBe('expired');
    expect(summary.urgentDeadlinesCount).toBe(3);
    expect(summary.expiredCount).toBe(1);
    expect(summary.warningCount).toBe(2);
    expect(summary.serviceMileage).toEqual({ target: 150000, mileageLeft: 500, status: 'warning' });
    expect(summary.serviceDate).toEqual({ target: '2026-12-10', daysLeft: 19, status: 'ok' });
    expect(summary.documents.map((d) => [d.type, d.label, d.status])).toEqual([
      ['osago', 'ОСАГО', 'expired'],
      ['tech_inspection', 'Техосмотр', 'warning'],
      ['kasko', 'КАСКО', 'ok'],
    ]);
  });
});

describe('30-day finances engine', () => {
  it('computes inclusive 30-day window start ISO', () => {
    expect(getWindowStartIso('2026-11-21')).toBe('2026-10-23');
  });

  it('computes rentDebt30d across open and closed rentals including dueDate === endDate === todayIso', () => {
    const rentals = [
      {
        id: 1,
        carId: 1,
        rateAmount: 2000,
        periodicity: 'daily' as const,
        startDate: '2026-11-19',
        endDate: '2026-11-21',
        active: false,
      },
      {
        id: 2,
        carId: 2,
        rateAmount: 2500,
        periodicity: 'daily' as const,
        startDate: '2026-11-20',
        endDate: null,
        active: true,
      },
      {
        id: 3,
        carId: 3,
        rateAmount: 5000,
        periodicity: 'daily' as const,
        startDate: '2026-10-01',
        endDate: '2026-10-22',
        active: false,
      },
    ];
    const payments = new Map([
      [1, [{ dueDate: '2026-11-19', amount: 2000, paidAt: '2026-11-19T09:00:00Z' }]],
      [2, [{ dueDate: '2026-11-20', amount: 2500, paidAt: null }]],
    ]);

    // Rental 1: 20th + 21st (closed today) = 4000; Rental 2: 20th overdue (21st is upcoming) = 2500; Rental 3: outside 30d = 0
    expect(computeRentDebt30d(rentals, payments, '2026-11-21')).toBe(6500);
  });

  it('computes per-car and fleet 30d financial summary including exclusions and negative netIncome30d', () => {
    const todayIso = '2026-11-21';
    const rentals = [
      {
        id: 10,
        carId: 1,
        rateAmount: 2000,
        periodicity: 'weekly' as const,
        startDate: '2026-11-07',
        endDate: null,
        active: true,
      },
      {
        id: 11,
        carId: 2,
        rateAmount: 3000,
        periodicity: 'weekly' as const,
        startDate: '2026-11-14',
        endDate: '2026-11-21',
        active: false,
      },
    ];
    const payments = [
      // Paid inside window
      { rentalId: 10, dueDate: '2026-11-07', amount: 2000, paidAt: '2026-11-07T10:00:00Z' },
      // Paid OUTSIDE window (2026-10-22 < 2026-10-23) -> excluded from paidRental30d
      { rentalId: 10, dueDate: '2026-10-22', amount: 9000, paidAt: '2026-10-22T10:00:00Z' },
      // Unpaid override on rental 10 dueDate 2026-11-14 -> counts as overdue 2200
      { rentalId: 10, dueDate: '2026-11-14', amount: 2200, paidAt: null },
      // Paid on rental 11 on 14th
      { rentalId: 11, dueDate: '2026-11-14', amount: 3000, paidAt: '2026-11-14T12:00:00Z' },
    ];
    const carFines = [
      { carId: 1, amount: 1500, status: 'unpaid' as const },
      { carId: 1, amount: 750, status: 'paid' as const },
      { carId: 2, amount: 3000, status: 'unpaid' as const },
    ];
    const maintenance = [
      // Inside window -> included
      { carId: 1, performedAt: '2026-10-23', totalCost: 8000 },
      // Outside window -> excluded
      { carId: 1, performedAt: '2026-10-22', totalCost: 40000 },
      // Inside window on todayIso -> included
      { carId: 2, performedAt: '2026-11-21', totalCost: 4000 },
    ];

    const car1Finances = computeCarFinances(1, rentals, payments, carFines, maintenance, todayIso);
    expect(car1Finances).toEqual({
      rentDebt30d: 2200,
      unpaidFinesSum: 1500,
      unpaidFinesCount: 1,
      paidRental30d: 2000,
      managerIncome30d: 0,
      maintenanceCost30d: 8000,
      netIncome30d: -6000,
    });

    const carSummaries: CarSummaryDto[] = [
      {
        id: 1,
        plate: 'А111АА 777',
        brand: 'Kia',
        model: 'Rio',
        status: 'in_rent',
        mileage: 100000,
        stsNumber: null,
        nextServiceMileage: null,
        nextServiceDate: null,
        ownerId: null,
        ownerName: null,
        unpaidFinesCount: 1,
        unpaidFinesSum: 1500,
        rentDebt30d: 2200,
        activeDriverId: null,
        activeDriverName: null,
        deadlineStatus: 'warning',
        urgentDeadlinesCount: 1,
      },
      {
        id: 2,
        plate: 'В222ВВ 777',
        brand: 'Hyundai',
        model: 'Solaris',
        status: 'available',
        mileage: 80000,
        stsNumber: null,
        nextServiceMileage: null,
        nextServiceDate: null,
        ownerId: null,
        ownerName: null,
        unpaidFinesCount: 1,
        unpaidFinesSum: 3000,
        rentDebt30d: 3000,
        activeDriverId: null,
        activeDriverName: null,
        deadlineStatus: 'ok',
        urgentDeadlinesCount: 0,
      },
    ];

    // Paid rental 30d = 2000 + 3000 = 5000; Maint 30d = 8000 + 4000 = 12000; Net = -7000
    // Rent debt = 2200 (car 1) + 3000 (car 2 closed today unpaid 21st) = 5200
    const fleet = computeFleetFinancialSummary(carSummaries, rentals, payments, maintenance, todayIso);
    expect(fleet).toEqual({
      totalRentDebt30d: 5200,
      totalUnpaidFinesSum: 4500,
      totalUnpaidFinesCount: 2,
      paidRental30d: 5000,
      managerIncome30d: 0,
      paidRentalMonth: 5000,
      managerIncomeMonth: 0,
      maintenanceCost30d: 12000,
      netIncome30d: -7000,
      urgentDeadlineCarsCount: 1,
    });
  });

  it('computes calendar month start ISO and manager fee with rounding', () => {
    expect(getMonthStartIso('2026-11-24')).toBe('2026-11-01');
    expect(getMonthStartIso('2026-01-01')).toBe('2026-01-01');

    expect(computeManagerFee(33330, 15)).toBe(5000);
    expect(computeManagerFee(1000, 12.5)).toBe(125);
    expect(computeManagerFee(1000, 0)).toBe(0);
  });

  it('aggregates paid amounts per rental before rounding manager commission and separates mixed rentals', () => {
    // 30 daily paid payments of 1111 at 15%: sum first -> 33330 -> Math.round(33330 * 0.15) = 5000 (not 30 * 167 = 5010)
    const dailyPayments = Array.from({ length: 30 }, (_, idx) => {
      const day = String(idx + 1).padStart(2, '0');
      return {
        rentalId: 1,
        dueDate: `2026-11-${day}`,
        amount: 1111,
        paidAt: `2026-11-${day}T10:00:00Z`,
      };
    });

    expect(
      sumPaidAndManagerInRange(
        [{ id: 1, managerCommissionPercent: 15 }],
        dailyPayments,
        '2026-11-01',
        '2026-11-30',
      ),
    ).toEqual({
      paidRental: 33330,
      managerIncome: 5000,
    });

    // Mixed rentals on the same car/fleet (10% closed + 15% active) + unpaid ignored + out-of-range ignored
    const mixedRentals = [
      { id: 10, managerCommissionPercent: 10 },
      { id: 11, managerCommissionPercent: 15 },
    ];
    const mixedPayments = [
      { rentalId: 10, dueDate: '2026-11-02', amount: 1005, paidAt: '2026-11-02T10:00:00Z' },
      { rentalId: 10, dueDate: '2026-11-03', amount: 1005, paidAt: '2026-11-03T10:00:00Z' },
      { rentalId: 11, dueDate: '2026-11-10', amount: 1000, paidAt: '2026-11-10T10:00:00Z' },
      { rentalId: 11, dueDate: '2026-11-11', amount: 1000, paidAt: null },
      { rentalId: 11, dueDate: '2026-10-31', amount: 5000, paidAt: '2026-10-31T10:00:00Z' },
    ];

    expect(
      sumPaidAndManagerInRange(mixedRentals, mixedPayments, '2026-11-01', '2026-11-30'),
    ).toEqual({
      paidRental: 3010,
      managerIncome: 351, // Math.round(2010 * 0.1) = 201 + Math.round(1000 * 0.15) = 150
    });
  });

  it('separates calendar month and 30-day window and subtracts manager income from owner netIncome30d', () => {
    const todayIso = '2026-11-10';
    // 30d window is [2026-10-12..2026-11-10]; calendar month is [2026-11-01..2026-11-10]
    const rentals = [
      {
        id: 10,
        carId: 1,
        rateAmount: 2000,
        periodicity: 'monthly' as const,
        startDate: '2026-10-31',
        endDate: '2026-11-02',
        active: false,
        managerCommissionPercent: 10,
      },
      {
        id: 11,
        carId: 1,
        rateAmount: 3000,
        periodicity: 'monthly' as const,
        startDate: '2026-11-01',
        endDate: null,
        active: true,
        managerCommissionPercent: 15,
      },
      {
        id: 12,
        carId: 2,
        rateAmount: 4000,
        periodicity: 'monthly' as const,
        startDate: '2026-10-25',
        endDate: null,
        active: true,
        // managerCommissionPercent omitted -> backward compatible 0%
      },
    ];
    const payments = [
      // In 30d window, OUT of calendar month (2026-10-31)
      { rentalId: 10, dueDate: '2026-10-31', amount: 2000, paidAt: '2026-10-31T09:00:00Z' },
      // In BOTH 30d window and calendar month (2026-11-01)
      { rentalId: 11, dueDate: '2026-11-01', amount: 3000, paidAt: '2026-11-01T09:00:00Z' },
      // In 30d window, OUT of calendar month (2026-10-25), omitted commission (0%)
      { rentalId: 12, dueDate: '2026-10-25', amount: 4000, paidAt: '2026-10-25T09:00:00Z' },
    ];
    const maintenance = [{ carId: 1, performedAt: '2026-11-05', totalCost: 1000 }];

    const car1Finances = computeCarFinances(1, rentals, payments, [], maintenance, todayIso);
    expect(car1Finances).toEqual({
      rentDebt30d: 0,
      unpaidFinesSum: 0,
      unpaidFinesCount: 0,
      paidRental30d: 5000,
      managerIncome30d: 650, // 2000*10% + 3000*15%
      maintenanceCost30d: 1000,
      netIncome30d: 3350, // 5000 - 650 - 1000
    });

    const car2Finances = computeCarFinances(2, rentals, payments, [], maintenance, todayIso);
    expect(car2Finances.managerIncome30d).toBe(0);
    expect(car2Finances.netIncome30d).toBe(4000);

    const fleet = computeFleetFinancialSummary([], rentals, payments, maintenance, todayIso, {
      fines: [],
      urgentDeadlineCarsCount: 0,
    });
    expect(fleet).toEqual({
      totalRentDebt30d: 0,
      totalUnpaidFinesSum: 0,
      totalUnpaidFinesCount: 0,
      paidRental30d: 9000,
      managerIncome30d: 650,
      paidRentalMonth: 3000,
      managerIncomeMonth: 450,
      maintenanceCost30d: 1000,
      netIncome30d: 7350, // 9000 - 650 - 1000
      urgentDeadlineCarsCount: 0,
    });
  });

  it('computes todayIso across explicit timezones, APP_TIMEZONE/TZ overrides, and invalid TZ fallback', () => {
    const instant = new Date('2026-11-30T22:30:00Z');
    expect(getTodayIso(instant, 'UTC')).toBe('2026-11-30');
    expect(getTodayIso(instant, 'America/New_York')).toBe('2026-11-30');

    const moscowToday = getTodayIso(instant, 'Europe/Moscow');
    expect(moscowToday).toBe('2026-12-01');
    expect(getMonthStartIso(moscowToday)).toBe('2026-12-01');
    expect(getTodayIso(instant, 'Asia/Vladivostok')).toBe('2026-12-01');

    const prevAppTz = process.env.APP_TIMEZONE;
    const prevTz = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      process.env.APP_TIMEZONE = 'Europe/Moscow';
      expect(getTodayIso(instant)).toBe('2026-12-01');

      delete process.env.APP_TIMEZONE;
      expect(getTodayIso(instant)).toBe('2026-11-30');

      process.env.TZ = ':/etc/localtime';
      expect(getTodayIso(instant)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      if (prevAppTz === undefined) delete process.env.APP_TIMEZONE;
      else process.env.APP_TIMEZONE = prevAppTz;
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});

describe('v2 validation schemas and Russian error messages', () => {
  it('validates stsNumber on createCarSchema/updateCarSchema without breaking PATCH partial updates', () => {
    const created = createCarSchema.parse({
      plate: 'А123ВС 777',
      brand: 'Kia',
      model: 'Rio',
      status: 'available',
      mileage: 1000,
      stsNumber: ' 99 01 123456 ',
    });
    expect(created.stsNumber).toBe('99 01 123456');

    const cleared = updateCarSchema.parse({ stsNumber: '   ' });
    expect(cleared).toEqual({ stsNumber: null });

    const partialNoSts = updateCarSchema.parse({ mileage: 5000 });
    expect(partialNoSts).toEqual({ mileage: 5000 });
    expect('stsNumber' in partialNoSts).toBe(false);

    expectRussianValidationError(
      createCarSchema.safeParse({
        plate: 'А123ВС 777',
        brand: 'Kia',
        model: 'Rio',
        status: 'available',
        mileage: 1000,
        stsNumber: '1'.repeat(33),
      }),
    );
    expectRussianValidationError(updateCarSchema.safeParse({}));
    expectRussianValidationError(updateCarSchema.safeParse({ stsNumber: 123 }));
  });

  it('rejects all invalid v2 payloads with Russian messages and no English Invalid input leaks', () => {
    const cases = [
      endRentalSchema.safeParse(null),
      endRentalSchema.safeParse({ endDate: 123 }),
      endRentalSchema.safeParse({ endDate: '2026-02-30' }),
      endRentalSchema.safeParse({ endDate: '' }),
      updateFineStatusSchema.safeParse(null),
      updateFineStatusSchema.safeParse({}),
      updateFineStatusSchema.safeParse({ status: 'pending' }),
      upsertDocumentsSchema.safeParse(null),
      upsertDocumentsSchema.safeParse({}),
      upsertDocumentsSchema.safeParse({ nextServiceMileage: Number.NaN, documents: [] }),
      upsertDocumentsSchema.safeParse({ nextServiceMileage: -1, documents: [] }),
      upsertDocumentsSchema.safeParse({ nextServiceDate: '2026-02-31', documents: [] }),
      upsertDocumentsSchema.safeParse({ documents: 'bad' }),
      upsertDocumentsSchema.safeParse({ documents: [{ type: 'unknown', expiresAt: '2026-12-01' }] }),
      upsertDocumentsSchema.safeParse({
        documents: [
          { type: 'osago', expiresAt: '2026-12-01' },
          { type: 'osago', expiresAt: '2026-12-02' },
        ],
      }),
      upsertDocumentsSchema.safeParse({ documents: [{ type: 'osago', expiresAt: 123 }] }),
      createDriverSchema.safeParse(null),
      createDriverSchema.safeParse({}),
      createDriverSchema.safeParse({ fullName: 123 }),
      createDriverSchema.safeParse({ fullName: 'Иванов', phone: 123 }),
      updateDriverSchema.safeParse(null),
      updateDriverSchema.safeParse({}),
      updateDriverSchema.safeParse({ archived: 'yes' }),
      createUserSchema.safeParse(null),
      createUserSchema.safeParse({}),
      createUserSchema.safeParse({ username: 'ab', password: 'secret', role: 'viewer' }),
      createUserSchema.safeParse({ username: 'bad name', password: 'secret', role: 'viewer' }),
      createUserSchema.safeParse({ username: 'valid_user', password: '123', role: 'viewer' }),
      createUserSchema.safeParse({ username: 'valid_user', password: 123456, role: 'viewer' }),
      createUserSchema.safeParse({ username: 'valid_user', password: 'secret', role: 'superadmin' }),
      updateUserSchema.safeParse(null),
      updateUserSchema.safeParse({}),
      updateUserSchema.safeParse({ role: 'root' }),
      updateUserSchema.safeParse({ password: '123' }),
      upsertRentalSchema.safeParse({
        driverId: 'abc',
        renterName: 'Иванов',
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: '2026-11-10',
      }),
      createFineSchema.safeParse({
        driverId: -5,
        resolutionNumber: '1',
        violatedAt: '2026-11-10',
        amount: 500,
        paymentDeadline: '2026-12-10',
        description: 'd',
      }),
    ];

    for (const res of cases) {
      expectRussianValidationError(res);
    }
  });

  it('parses valid v2 schemas cleanly', () => {
    expect(endRentalSchema.parse({})).toEqual({});
    expect(endRentalSchema.parse({ endDate: '2026-11-21' })).toEqual({ endDate: '2026-11-21' });
    expect(updateFineStatusSchema.parse({ status: 'paid' })).toEqual({ status: 'paid' });
    expect(
      upsertDocumentsSchema.parse({
        nextServiceMileage: 150000,
        nextServiceDate: '',
        documents: [{ type: 'osago', expiresAt: '2027-01-01', policyNumber: '  XX 1 ', notes: '' }],
      }),
    ).toEqual({
      nextServiceMileage: 150000,
      nextServiceDate: null,
      documents: [{ type: 'osago', expiresAt: '2027-01-01', policyNumber: 'XX 1', notes: null }],
    });
    expect(createDriverSchema.parse({ fullName: ' Сидоров Иван ', phone: '', notes: 'ок' })).toEqual({
      fullName: 'Сидоров Иван',
      phone: null,
      notes: 'ок',
    });
    expect(updateDriverSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(createUserSchema.parse({ username: ' manager1 ', password: 'secret', role: 'viewer' })).toEqual({
      username: 'manager1',
      displayName: null,
      password: 'secret',
      role: 'viewer',
    });
    expect(updateUserSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' });
  });
});
