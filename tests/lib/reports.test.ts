import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type AppDb } from '@/db';
import { cars, maintenanceRecords, rentalPayments, rentals } from '@/db/schema';
import {
  buildReport,
  formatReportPeriodLabel,
  formatReportText,
  formatSignedRubPlain,
  getCalendarMonthRange,
  getIsoWeekRange,
} from '@/lib/reports';
import { reportQuerySchema } from '@/lib/validation';

describe('reports date helpers and validation', () => {
  it('computes ISO Monday..Sunday week range across month and year boundaries', () => {
    expect(getIsoWeekRange('2026-11-25')).toEqual({
      start: '2026-11-23',
      end: '2026-11-29',
    });
    expect(getIsoWeekRange('2026-11-29')).toEqual({
      start: '2026-11-23',
      end: '2026-11-29',
    });
    expect(getIsoWeekRange('2026-12-31')).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
    });
  });

  it('computes calendar month range including leap-year February', () => {
    expect(getCalendarMonthRange('2026-11')).toEqual({
      start: '2026-11-01',
      end: '2026-11-30',
    });
    expect(getCalendarMonthRange('2028-02')).toEqual({
      start: '2028-02-01',
      end: '2028-02-29',
    });
    expect(getCalendarMonthRange('2026-02')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
  });

  it('formats period labels deterministically without em/en dashes', () => {
    expect(formatReportPeriodLabel('weekly', '2026-11-23', '2026-11-29')).toBe(
      'неделя с 23.11.2026 по 29.11.2026',
    );
    expect(formatReportPeriodLabel('monthly', '2026-11-01', '2026-11-30')).toBe('Ноябрь 2026');
  });

  it('formats signed ruble amounts deterministically', () => {
    expect(formatSignedRubPlain(10000)).toBe('10 000 ₽');
    expect(formatSignedRubPlain(0)).toBe('0 ₽');
    expect(formatSignedRubPlain(-16500)).toBe('-16 500 ₽');
  });

  it('validates reportQuerySchema with Russian errors', () => {
    const okWeekly = reportQuerySchema.safeParse({
      type: 'weekly',
      date: '2026-11-25',
    });
    expect(okWeekly.success).toBe(true);
    if (okWeekly.success) {
      expect(okWeekly.data.carId).toBeNull();
      expect(okWeekly.data.includeMaintenance).toBe(false);
    }

    const missingDate = reportQuerySchema.safeParse({ type: 'weekly' });
    expect(missingDate.success).toBe(false);
    if (!missingDate.success) {
      expect(missingDate.error.issues[0]?.message).toBe('Укажите дату недели');
    }

    const missingMonth = reportQuerySchema.safeParse({ type: 'monthly' });
    expect(missingMonth.success).toBe(false);
    if (!missingMonth.success) {
      expect(missingMonth.error.issues[0]?.message).toBe('Укажите месяц');
    }

    const badCarId = reportQuerySchema.safeParse({
      type: 'weekly',
      date: '2026-11-25',
      carId: '0',
    });
    expect(badCarId.success).toBe(false);
  });
});

describe('buildReport and formatReportText', () => {
  let db: AppDb;

  beforeAll(() => {
    db = createDb(':memory:');
  });

  beforeEach(async () => {
    await db.delete(maintenanceRecords);
    await db.delete(rentalPayments);
    await db.delete(rentals);
    await db.delete(cars);
  });

  it('omits maintenance for weekly when includeMaintenance=false and includes it when true', async () => {
    const [car] = await db
      .insert(cars)
      .values({ plate: 'А123ВС 777', brand: 'Kia', model: 'Rio', status: 'in_rent', mileage: 10000 })
      .returning();

    const [rental] = await db
      .insert(rentals)
      .values({
        carId: car.id,
        renterName: 'Иван Петров',
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: '2026-11-01',
        active: true,
        managerCommissionPercent: 10,
      })
      .returning();

    await db.insert(rentalPayments).values([
      { rentalId: rental.id, dueDate: '2026-11-24', amount: 14000, paidAt: '2026-11-24T12:00:00Z' },
      { rentalId: rental.id, dueDate: '2026-11-25', amount: 6000, paidAt: null },
      { rentalId: rental.id, dueDate: '2026-11-10', amount: 5000, paidAt: '2026-11-10T12:00:00Z' },
    ]);

    await db.insert(maintenanceRecords).values({
      carId: car.id,
      title: 'ТО-1',
      performedAt: '2026-11-26',
      mileage: 10500,
      laborCost: 3000,
      totalCost: 3000,
    });

    const withoutMaint = await buildReport(db, {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      includeMaintenance: false,
    });

    expect(withoutMaint.includeMaintenance).toBe(false);
    expect(withoutMaint.paidRental).toBe(14000);
    expect(withoutMaint.managerIncome).toBe(1400);
    expect(withoutMaint.maintenanceCost).toBe(0);
    expect(withoutMaint.ownerPayout).toBe(12600);
    expect(withoutMaint.textPlain).not.toContain('Ремонт:');
    expect(withoutMaint.textTelegram).not.toContain('Ремонт:');

    const withMaint = await buildReport(db, {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      includeMaintenance: true,
    });

    expect(withMaint.includeMaintenance).toBe(true);
    expect(withMaint.maintenanceCost).toBe(3000);
    expect(withMaint.ownerPayout).toBe(9600);
    expect(withMaint.textPlain).toContain('Ремонт: 3 000 ₽');
    expect(withMaint.textTelegram).toContain('Ремонт: 3 000 ₽');
  });

  it('forces includeMaintenance=true for monthly reports and renders negative owner payout', async () => {
    const [car] = await db
      .insert(cars)
      .values({ plate: 'В777ОР 77', brand: 'Hyundai', model: 'Solaris', status: 'in_rent', mileage: 20000 })
      .returning();

    const [rental] = await db
      .insert(rentals)
      .values({
        carId: car.id,
        renterName: 'Сергей Смирнов',
        rateAmount: 2500,
        periodicity: 'daily',
        startDate: '2026-11-01',
        active: true,
        managerCommissionPercent: 15,
      })
      .returning();

    await db.insert(rentalPayments).values({
      rentalId: rental.id,
      dueDate: '2026-11-15',
      amount: 10000,
      paidAt: '2026-11-15T10:00:00Z',
    });

    await db.insert(maintenanceRecords).values({
      carId: car.id,
      title: 'Замена КПП',
      performedAt: '2026-11-18',
      mileage: 21000,
      laborCost: 25000,
      totalCost: 25000,
    });

    const monthly = await buildReport(db, {
      type: 'monthly',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      carId: car.id,
      includeMaintenance: false,
    });

    expect(monthly.includeMaintenance).toBe(true);
    expect(monthly.carLabel).toBe('Hyundai Solaris (В777ОР 77)');
    expect(monthly.paidRental).toBe(10000);
    expect(monthly.managerIncome).toBe(1500);
    expect(monthly.maintenanceCost).toBe(25000);
    expect(monthly.ownerPayout).toBe(-16500);
    expect(monthly.textPlain).toContain('-16 500 ₽');
    expect(monthly.textTelegram).toContain('**-16 500 ₽**');
    expect(monthly.textPlain).not.toContain('По машинам:');
  });

  it('computes manager income across two rentals with different commissions on one car', async () => {
    const [car] = await db
      .insert(cars)
      .values({ plate: 'Е555КХ 99', brand: 'Skoda', model: 'Rapid', status: 'in_rent', mileage: 30000 })
      .returning();

    const [rental1] = await db
      .insert(rentals)
      .values({
        carId: car.id,
        renterName: 'Водитель 1',
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: '2026-11-01',
        endDate: '2026-11-10',
        active: false,
        managerCommissionPercent: 10,
      })
      .returning();

    const [rental2] = await db
      .insert(rentals)
      .values({
        carId: car.id,
        renterName: 'Водитель 2',
        rateAmount: 2200,
        periodicity: 'daily',
        startDate: '2026-11-11',
        active: true,
        managerCommissionPercent: 15,
      })
      .returning();

    await db.insert(rentalPayments).values([
      { rentalId: rental1.id, dueDate: '2026-11-05', amount: 10000, paidAt: '2026-11-05T09:00:00Z' },
      { rentalId: rental2.id, dueDate: '2026-11-15', amount: 20000, paidAt: '2026-11-15T09:00:00Z' },
    ]);

    const report = await buildReport(db, {
      type: 'monthly',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      carId: null,
      includeMaintenance: true,
    });

    expect(report.paidRental).toBe(30000);
    expect(report.managerIncome).toBe(4000);
    expect(report.ownerPayout).toBe(26000);
  });

  it('formats plain and telegram text without emojis, em/en dashes, spaced hyphens, or MarkdownV2 escapes', () => {
    const sample = {
      type: 'weekly' as const,
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      periodLabel: 'неделя с 23.11.2026 по 29.11.2026',
      carId: null,
      carLabel: 'Все машины',
      includeMaintenance: true,
      paidRental: 20000,
      managerIncome: 2000,
      maintenanceCost: 3000,
      ownerPayout: 15000,
      cars: [
        {
          carId: 1,
          plate: 'А123ВС 777',
          brand: 'Kia',
          model: 'Rio',
          paidRental: 20000,
          managerIncome: 2000,
          maintenanceCost: 3000,
          ownerPayout: 15000,
        },
      ],
    };

    const plain = formatReportText(sample, 'plain');
    const telegram = formatReportText(sample, 'telegram');

    expect(plain).not.toContain('*');
    expect(telegram).toContain('**Еженедельный отчёт (неделя с 23.11.2026 по 29.11.2026)**');
    expect(telegram).toContain('**По машинам:**');
    expect(telegram).toContain('**15 000 ₽**');

    for (const output of [plain, telegram]) {
      expect(output).not.toMatch(/[—–]/);
      expect(output).not.toContain(' - ');
      expect(output).not.toContain('\\.');
      expect(output).not.toContain('\\-');
      expect(output).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(output).toContain('Kia Rio (А123ВС 777)');
    }
  });

  it('returns zero totals, empty cars list, and clean text on an empty fleet', async () => {
    const report = await buildReport(db, {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      includeMaintenance: true,
    });

    expect(report.paidRental).toBe(0);
    expect(report.managerIncome).toBe(0);
    expect(report.maintenanceCost).toBe(0);
    expect(report.ownerPayout).toBe(0);
    expect(report.cars).toEqual([]);
    expect(report.carLabel).toBe('Все машины');
    expect(report.textPlain).toContain('К выплате собственнику: 0 ₽');
    expect(report.textPlain).not.toContain('По машинам:');
    expect(report.textTelegram).toContain('К выплате собственнику: **0 ₽**');
    expect(report.textTelegram).not.toContain('По машинам:');
    for (const output of [report.textPlain, report.textTelegram]) {
      expect(output).not.toMatch(/[—–]/);
      expect(output).not.toContain(' - ');
      expect(output).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('computes negative ownerPayout for a car in repair with zero rentals/payments and 15 000 maintenance', async () => {
    const [car] = await db
      .insert(cars)
      .values({ plate: 'О999АА 77', brand: 'Lada', model: 'Vesta', status: 'in_repair', mileage: 80000 })
      .returning();

    await db.insert(maintenanceRecords).values({
      carId: car.id,
      title: 'Ремонт двигателя',
      performedAt: '2026-11-25',
      mileage: 80000,
      laborCost: 15000,
      totalCost: 15000,
    });

    const report = await buildReport(db, {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      includeMaintenance: true,
    });

    expect(report.paidRental).toBe(0);
    expect(report.managerIncome).toBe(0);
    expect(report.maintenanceCost).toBe(15000);
    expect(report.ownerPayout).toBe(-15000);
    expect(report.cars).toEqual([
      {
        carId: car.id,
        plate: 'О999АА 77',
        brand: 'Lada',
        model: 'Vesta',
        paidRental: 0,
        managerIncome: 0,
        maintenanceCost: 15000,
        ownerPayout: -15000,
      },
    ]);
    expect(report.textPlain).toContain('К выплате собственнику: -15 000 ₽');
    expect(report.textTelegram).toContain('К выплате собственнику: **-15 000 ₽**');
  });
});
