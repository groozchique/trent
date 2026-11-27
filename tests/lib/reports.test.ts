import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type AppDb } from '@/db';
import { cars, maintenanceRecords, rentalPayments, rentals, users } from '@/db/schema';
import { ApiError } from '@/lib/cars';
import {
  buildReport,
  formatReportPeriodLabel,
  formatReportText,
  formatSignedRubPlain,
  getCalendarMonthRange,
  getCalendarYearRange,
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

  it('computes calendar year range and rejects invalid years with 400', () => {
    expect(getCalendarYearRange('2026')).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });

    for (const badYear of ['1999', '202a', '2101']) {
      expect(() => getCalendarYearRange(badYear)).toThrow(ApiError);
      try {
        getCalendarYearRange(badYear);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(400);
        expect((err as ApiError).message).toMatch(/[А-Яа-яЁё]/);
      }
    }
  });

  it('formats period labels deterministically without em/en dashes', () => {
    expect(formatReportPeriodLabel('weekly', '2026-11-23', '2026-11-29')).toBe(
      'неделя с 23.11.2026 по 29.11.2026',
    );
    expect(formatReportPeriodLabel('monthly', '2026-11-01', '2026-11-30')).toBe('Ноябрь 2026');
    expect(formatReportPeriodLabel('yearly', '2026-01-01', '2026-12-31')).toBe('2026 год');
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
      expect(okWeekly.data.ownerId).toBeNull();
      expect(okWeekly.data.includeFinancial).toBe(true);
      expect(okWeekly.data.includeMaintenance).toBe(true);
    }

    const okYearly = reportQuerySchema.safeParse({
      type: 'yearly',
      year: '2026',
    });
    expect(okYearly.success).toBe(true);

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

    const missingYear = reportQuerySchema.safeParse({ type: 'yearly' });
    expect(missingYear.success).toBe(false);
    if (!missingYear.success) {
      expect(missingYear.error.issues[0]?.message).toBe('Укажите год');
    }

    const invalidYear = reportQuerySchema.safeParse({ type: 'yearly', year: '1999' });
    expect(invalidYear.success).toBe(false);

    const badCarId = reportQuerySchema.safeParse({
      type: 'weekly',
      date: '2026-11-25',
      carId: '0',
    });
    expect(badCarId.success).toBe(false);

    const carAndOwner = reportQuerySchema.safeParse({
      type: 'weekly',
      date: '2026-11-25',
      carId: '1',
      ownerId: '2',
    });
    expect(carAndOwner.success).toBe(false);
    if (!carAndOwner.success) {
      expect(carAndOwner.error.issues[0]?.message).toBe('Укажите либо автомобиль, либо собственника');
    }

    const noSections = reportQuerySchema.safeParse({
      type: 'weekly',
      date: '2026-11-25',
      includeFinancial: false,
      includeMaintenance: false,
    });
    expect(noSections.success).toBe(false);
    if (!noSections.success) {
      expect(noSections.error.issues[0]?.message).toBe('Выберите хотя бы один раздел отчёта');
    }
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
    await db.delete(users);
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
    expect(withMaint.textTelegram).toContain('> Ремонт: `3 000 ₽`');
  });

  it('respects includeMaintenance=false for monthly reports and renders negative owner payout when true', async () => {
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

    const monthlyWithoutMaint = await buildReport(db, {
      type: 'monthly',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      carId: car.id,
      includeFinancial: true,
      includeMaintenance: false,
    });

    expect(monthlyWithoutMaint.includeMaintenance).toBe(false);
    expect(monthlyWithoutMaint.maintenanceCost).toBe(0);
    expect(monthlyWithoutMaint.maintenanceCount).toBe(0);
    expect(monthlyWithoutMaint.ownerPayout).toBe(8500);
    expect(monthlyWithoutMaint.cars[0]?.maintenanceItems).toEqual([]);
    expect(monthlyWithoutMaint.textPlain).not.toContain('Ремонт:');
    expect(monthlyWithoutMaint.textTelegram).not.toContain('Ремонт:');

    const monthly = await buildReport(db, {
      type: 'monthly',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      carId: car.id,
      includeFinancial: true,
      includeMaintenance: true,
    });

    expect(monthly.includeMaintenance).toBe(true);
    expect(monthly.carLabel).toBe('Hyundai Solaris (В777ОР 77)');
    expect(monthly.paidRental).toBe(10000);
    expect(monthly.managerIncome).toBe(1500);
    expect(monthly.maintenanceCost).toBe(25000);
    expect(monthly.maintenanceCount).toBe(1);
    expect(monthly.ownerPayout).toBe(-16500);
    expect(monthly.textPlain).toContain('-16 500 ₽');
    expect(monthly.textPlain).toContain('- 18.11.2026, Замена КПП: 25 000 ₽');
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
      ownerId: null,
      ownerName: null,
      includeFinancial: true,
      includeMaintenance: true,
      paidRental: 20000,
      managerIncome: 2000,
      maintenanceCost: 3000,
      maintenanceCount: 1,
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
          maintenanceItems: [
            {
              id: 1,
              performedAt: '2026-11-26',
              title: 'ТО-1',
              mileage: 10500,
              totalCost: 3000,
            },
          ],
        },
      ],
    };

    const plain = formatReportText(sample, 'plain');
    const telegram = formatReportText(sample, 'telegram');

    expect(plain).not.toContain('*');
    expect(plain).not.toContain('`');
    expect(plain).not.toContain('>');
    expect(telegram).toContain('**Еженедельный отчёт**\n__неделя с 23.11.2026 по 29.11.2026__');
    expect(telegram).toContain('Автомобиль: **Все машины**');
    expect(telegram).toContain('> Оплаченная аренда: `20 000 ₽`');
    expect(telegram).toContain('> Менеджеру автопарка: `2 000 ₽`');
    expect(telegram).toContain('> Ремонт: `3 000 ₽`');
    expect(telegram).toContain('> К выплате собственнику: **15 000 ₽**');
    expect(telegram).toContain('**По машинам:**');
    expect(telegram).toContain(
      '• **Kia Rio** (`А123ВС 777`): аренда `20 000 ₽`, менеджеру `2 000 ₽`, ремонт `3 000 ₽`, собственнику **15 000 ₽**',
    );
    expect(telegram).toContain('**Работы по ремонту:**');
    expect(telegram).toContain('> `26.11.2026`, ТО-1: `3 000 ₽`');

    for (const output of [plain, telegram]) {
      expect(output).not.toMatch(/[—–]/);
      expect(output).not.toContain(' - ');
      expect(output).not.toContain('\\.');
      expect(output).not.toContain('\\-');
      expect(output).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(output).toContain('Kia Rio');
      expect(output).toContain('А123ВС 777');
    }
  });

  it('sanitizes newlines and markdown tokens in user-supplied report fields without breaking Telegram quotes', () => {
    const dirty = {
      type: 'weekly' as const,
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      periodLabel: 'неделя с 23.11.2026 по 29.11.2026',
      carId: 1,
      carLabel: 'Kia Rio (А123ВС 777)',
      ownerId: null,
      ownerName: null,
      includeFinancial: true,
      includeMaintenance: true,
      paidRental: 10000,
      managerIncome: 1000,
      maintenanceCost: 2000,
      maintenanceCount: 1,
      ownerPayout: 7000,
      cars: [
        {
          carId: 1,
          plate: 'А123ВС`777',
          brand: 'Kia**',
          model: 'Rio\nLine2',
          paidRental: 10000,
          managerIncome: 1000,
          maintenanceCost: 2000,
          ownerPayout: 7000,
          maintenanceItems: [
            {
              id: 1,
              performedAt: '2026-11-26',
              title: 'ТО_60\nЗамена `свечей` **срочно**',
              mileage: 60000,
              totalCost: 2000,
            },
          ],
        },
      ],
    };

    const telegram = formatReportText(dirty, 'telegram');
    expect(telegram).toContain("> `26.11.2026`, ТО_60 Замена 'свечей' срочно: `2 000 ₽`");
    expect(telegram).toContain('Автомобиль: **Kia Rio Line2** (`А123ВС\'777`)');
    expect(telegram).not.toContain('\\\n');
    expect(telegram).not.toContain('\\.');
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
    expect(report.textTelegram).toContain('> К выплате собственнику: **0 ₽**');
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

    const [maint] = await db
      .insert(maintenanceRecords)
      .values({
        carId: car.id,
        title: 'Ремонт двигателя',
        performedAt: '2026-11-25',
        mileage: 80000,
        laborCost: 15000,
        totalCost: 15000,
      })
      .returning();

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
    expect(report.maintenanceCount).toBe(1);
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
        maintenanceItems: [
          {
            id: maint.id,
            performedAt: '2026-11-25',
            title: 'Ремонт двигателя',
            mileage: 80000,
            totalCost: 15000,
          },
        ],
      },
    ]);
    expect(report.textPlain).toContain('К выплате собственнику: -15 000 ₽');
    expect(report.textTelegram).toContain('> К выплате собственнику: **-15 000 ₽**');
  });

  it('aggregates yearly report across full calendar year and respects includeMaintenance=false', async () => {
    const [car] = await db
      .insert(cars)
      .values({ plate: 'У100УУ 77', brand: 'Kia', model: 'Rio', status: 'in_rent', mileage: 45000 })
      .returning();

    const [rental] = await db
      .insert(rentals)
      .values({
        carId: car.id,
        renterName: 'Олег',
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: '2026-01-01',
        active: true,
        managerCommissionPercent: 10,
      })
      .returning();

    await db.insert(rentalPayments).values([
      { rentalId: rental.id, dueDate: '2026-01-10', amount: 10000, paidAt: '2026-01-10T10:00:00Z' },
      { rentalId: rental.id, dueDate: '2026-12-20', amount: 20000, paidAt: '2026-12-20T10:00:00Z' },
      { rentalId: rental.id, dueDate: '2025-12-31', amount: 9000, paidAt: '2025-12-31T10:00:00Z' },
    ]);

    await db.insert(maintenanceRecords).values({
      carId: car.id,
      title: 'Замена масла',
      performedAt: '2026-06-15',
      mileage: 42000,
      laborCost: 4000,
      totalCost: 4000,
    });

    const yearlyFinOnly = await buildReport(db, {
      type: 'yearly',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      carId: null,
      includeFinancial: true,
      includeMaintenance: false,
    });

    expect(yearlyFinOnly.periodLabel).toBe('2026 год');
    expect(yearlyFinOnly.paidRental).toBe(30000);
    expect(yearlyFinOnly.managerIncome).toBe(3000);
    expect(yearlyFinOnly.maintenanceCost).toBe(0);
    expect(yearlyFinOnly.ownerPayout).toBe(27000);
    expect(yearlyFinOnly.textPlain).toContain('Годовой финансовый отчёт (2026 год)');
    expect(yearlyFinOnly.textPlain).not.toContain('Ремонт:');
  });

  it('builds maintenance-only report with ordered items and empty state', async () => {
    const [car1] = await db
      .insert(cars)
      .values({ plate: 'А100АА 77', brand: 'Kia', model: 'Rio', status: 'in_rent', mileage: 10000 })
      .returning();
    const [car2] = await db
      .insert(cars)
      .values({ plate: 'В200ВВ 77', brand: 'Lada', model: 'Granta', status: 'available', mileage: 20000 })
      .returning();

    const [rental] = await db
      .insert(rentals)
      .values({
        carId: car1.id,
        renterName: 'Водитель',
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: '2026-01-01',
        active: true,
        managerCommissionPercent: 10,
      })
      .returning();

    await db.insert(rentalPayments).values({
      rentalId: rental.id,
      dueDate: '2026-11-25',
      amount: 50000,
      paidAt: '2026-11-25T10:00:00Z',
    });

    const [mLater] = await db
      .insert(maintenanceRecords)
      .values({
        carId: car1.id,
        title: 'Замена колодок',
        performedAt: '2026-11-27',
        mileage: 11200,
        laborCost: 4500,
        totalCost: 4500,
      })
      .returning();
    const [mEarlier] = await db
      .insert(maintenanceRecords)
      .values({
        carId: car1.id,
        title: 'Шиномонтаж',
        performedAt: '2026-11-24',
        mileage: 11000,
        laborCost: 2000,
        totalCost: 2000,
      })
      .returning();

    const maintOnly = await buildReport(db, {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      includeFinancial: false,
      includeMaintenance: true,
    });

    expect(maintOnly.includeFinancial).toBe(false);
    expect(maintOnly.includeMaintenance).toBe(true);
    expect(maintOnly.paidRental).toBe(0);
    expect(maintOnly.managerIncome).toBe(0);
    expect(maintOnly.ownerPayout).toBe(0);
    expect(maintOnly.maintenanceCost).toBe(6500);
    expect(maintOnly.maintenanceCount).toBe(2);
    expect(maintOnly.cars[0]?.maintenanceItems).toEqual([
      { id: mEarlier.id, performedAt: '2026-11-24', title: 'Шиномонтаж', mileage: 11000, totalCost: 2000 },
      { id: mLater.id, performedAt: '2026-11-27', title: 'Замена колодок', mileage: 11200, totalCost: 4500 },
    ]);
    expect(maintOnly.cars[1]?.maintenanceItems).toEqual([]);
    expect(maintOnly.textPlain).toContain('Еженедельный отчёт по ремонту');
    expect(maintOnly.textPlain).toContain('Итого на ремонт: 6 500 ₽ (записей: 2)');
    expect(maintOnly.textPlain).toContain('- 24.11.2026, Шиномонтаж: 2 000 ₽');
    expect(maintOnly.textPlain).toContain('- 27.11.2026, Замена колодок: 4 500 ₽');
    expect(maintOnly.textPlain).not.toContain('Оплаченная аренда:');
    expect(maintOnly.textPlain).not.toContain('К выплате собственнику:');
    expect(maintOnly.textPlain).not.toMatch(/[—–]/);
    expect(maintOnly.textPlain).not.toContain(' - ');

    const emptyMaintOnly = await buildReport(db, {
      type: 'yearly',
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      carId: car2.id,
      includeFinancial: false,
      includeMaintenance: true,
    });
    expect(emptyMaintOnly.maintenanceCount).toBe(0);
    expect(emptyMaintOnly.textPlain).toContain('Работ по ремонту за период не было');
  });

  it('filters by ownerId, handles zero-car owner, and throws 404 for missing or non-owner user', async () => {
    const [owner1] = await db
      .insert(users)
      .values({ username: 'owner1', displayName: 'Иван Собственник', passwordHash: 'x', role: 'owner' })
      .returning();
    const [owner2] = await db
      .insert(users)
      .values({ username: 'owner2', displayName: null, passwordHash: 'x', role: 'owner' })
      .returning();
    const [adminUser] = await db
      .insert(users)
      .values({ username: 'admin1', displayName: 'Админ', passwordHash: 'x', role: 'admin' })
      .returning();

    const [carOwner1] = await db
      .insert(cars)
      .values({ plate: 'К111КК 77', brand: 'Kia', model: 'K5', status: 'in_rent', mileage: 10000, ownerId: owner1.id })
      .returning();
    const [carOther] = await db
      .insert(cars)
      .values({ plate: 'М222ММ 77', brand: 'Skoda', model: 'Octavia', status: 'in_rent', mileage: 15000, ownerId: null })
      .returning();

    const [r1] = await db
      .insert(rentals)
      .values({
        carId: carOwner1.id,
        renterName: 'Д1',
        rateAmount: 3000,
        periodicity: 'daily',
        startDate: '2026-11-01',
        active: true,
        managerCommissionPercent: 10,
      })
      .returning();
    const [r2] = await db
      .insert(rentals)
      .values({
        carId: carOther.id,
        renterName: 'Д2',
        rateAmount: 4000,
        periodicity: 'daily',
        startDate: '2026-11-01',
        active: true,
        managerCommissionPercent: 10,
      })
      .returning();

    await db.insert(rentalPayments).values([
      { rentalId: r1.id, dueDate: '2026-11-25', amount: 15000, paidAt: '2026-11-25T10:00:00Z' },
      { rentalId: r2.id, dueDate: '2026-11-25', amount: 40000, paidAt: '2026-11-25T10:00:00Z' },
    ]);

    const ownerReport = await buildReport(db, {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      ownerId: owner1.id,
      includeFinancial: true,
      includeMaintenance: false,
    });

    expect(ownerReport.ownerId).toBe(owner1.id);
    expect(ownerReport.ownerName).toBe('Иван Собственник');
    expect(ownerReport.cars).toHaveLength(1);
    expect(ownerReport.cars[0]?.carId).toBe(carOwner1.id);
    expect(ownerReport.paidRental).toBe(15000);
    expect(ownerReport.ownerPayout).toBe(13500);
    expect(ownerReport.textPlain).toContain('Собственник: Иван Собственник');

    const emptyOwnerReport = await buildReport(db, {
      type: 'weekly',
      periodStart: '2026-11-23',
      periodEnd: '2026-11-29',
      carId: null,
      ownerId: owner2.id,
      includeFinancial: true,
      includeMaintenance: true,
    });
    expect(emptyOwnerReport.ownerId).toBe(owner2.id);
    expect(emptyOwnerReport.ownerName).toBe('owner2');
    expect(emptyOwnerReport.cars).toEqual([]);
    expect(emptyOwnerReport.paidRental).toBe(0);
    expect(emptyOwnerReport.maintenanceCount).toBe(0);

    await expect(
      buildReport(db, {
        type: 'weekly',
        periodStart: '2026-11-23',
        periodEnd: '2026-11-29',
        carId: null,
        ownerId: 99999,
        includeFinancial: true,
        includeMaintenance: false,
      }),
    ).rejects.toMatchObject({ status: 404, message: 'Собственник не найден' });

    await expect(
      buildReport(db, {
        type: 'weekly',
        periodStart: '2026-11-23',
        periodEnd: '2026-11-29',
        carId: null,
        ownerId: adminUser.id,
        includeFinancial: true,
        includeMaintenance: false,
      }),
    ).rejects.toMatchObject({ status: 404, message: 'Собственник не найден' });
  });
});
