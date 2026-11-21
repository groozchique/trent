import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '@/db';
import { cars, drivers, fines, rentals } from '@/db/schema';
import { getFinesProvider, type ExternalFine, type FinesProvider } from '@/lib/fines/provider';
import { MockFinesProvider } from '@/lib/fines/mock-provider';
import { syncCarFines } from '@/lib/fines/sync';

describe('syncCarFines', () => {
  it('upserts by resolutionNumber without creating duplicates on repeated sync', async () => {
    const db = createDb(':memory:');
    const [car] = await db
      .insert(cars)
      .values({
        plate: 'А123ВС 777',
        brand: 'Kia',
        model: 'Rio',
        status: 'in_rent',
        mileage: 120000,
      })
      .returning();

    const provider: FinesProvider = {
      async fetchFinesByPlate() {
        return [
          {
            resolutionNumber: '18810177261100000001',
            violatedAt: '2026-11-10T14:22:00+03:00',
            amount: 1000,
            discountAmount: 750,
            discountDeadline: '2026-12-10',
            paymentDeadline: '2027-01-19',
            description: 'Превышение скорости на 20–40 км/ч',
            status: 'unpaid',
          },
        ];
      },
    };

    const first = await syncCarFines(db, car.id, car.plate, provider);
    const second = await syncCarFines(db, car.id, car.plate, provider);
    const rows = await db.select().from(fines).where(eq(fines.carId, car.id));

    expect(first).toEqual({ inserted: 1, updated: 0 });
    expect(second).toEqual({ inserted: 0, updated: 1 });
    expect(rows).toHaveLength(1);
  });

  it('updates mutable fields when carId matches and preserves carId on cross-car conflict', async () => {
    const db = createDb(':memory:');
    const [car1, car2] = await db
      .insert(cars)
      .values([
        {
          plate: 'В456ОР 777',
          brand: 'Hyundai',
          model: 'Solaris',
          status: 'in_rent',
          mileage: 95000,
        },
        {
          plate: 'Е789КХ 799',
          brand: 'Skoda',
          model: 'Octavia',
          status: 'available',
          mileage: 60000,
        },
      ])
      .returning();

    let payload: ExternalFine[] = [
      {
        resolutionNumber: '18810177261100000099',
        violatedAt: '2026-11-01T10:15:00+03:00',
        amount: 1500,
        discountAmount: 1125,
        discountDeadline: '2026-12-01',
        paymentDeadline: '2027-01-10',
        description: 'Несоблюдение требований знаков',
        status: 'unpaid',
      },
    ];

    const provider: FinesProvider = {
      async fetchFinesByPlate() {
        return payload;
      },
    };

    expect(await syncCarFines(db, car1.id, car1.plate, provider)).toEqual({
      inserted: 1,
      updated: 0,
    });

    // Same car updates mutable fields.
    payload = [
      {
        resolutionNumber: '18810177261100000099',
        violatedAt: '2026-11-01T10:20:00+03:00',
        amount: 3000,
        discountAmount: null,
        discountDeadline: null,
        paymentDeadline: '2027-01-25',
        description: 'Повторное нарушение: несоблюдение требований знаков',
        status: 'paid',
      },
    ];
    expect(await syncCarFines(db, car1.id, car1.plate, provider)).toEqual({
      inserted: 0,
      updated: 1,
    });

    // Different car syncing conflicting resolutionNumber leaves car1's fine untouched & uncounted.
    payload = [
      {
        resolutionNumber: '18810177261100000099',
        violatedAt: '2026-11-02T12:00:00+03:00',
        amount: 5000,
        discountAmount: null,
        discountDeadline: null,
        paymentDeadline: '2027-02-01',
        description: 'Попытка перезаписи чужого штрафа',
        status: 'unpaid',
      },
      {
        resolutionNumber: '18810177261100000100',
        violatedAt: '2026-11-15T18:40:00+03:00',
        amount: 500,
        discountAmount: 375,
        discountDeadline: '2026-12-15',
        paymentDeadline: '2027-01-24',
        description: 'Нарушение правил применения ремней безопасности',
        status: 'unpaid',
      },
    ];

    expect(await syncCarFines(db, car2.id, car2.plate, provider)).toEqual({
      inserted: 1,
      updated: 0,
    });

    const car1Rows = await db.select().from(fines).where(eq(fines.carId, car1.id));
    expect(car1Rows).toHaveLength(1);
    expect(car1Rows[0]).toMatchObject({
      carId: car1.id,
      resolutionNumber: '18810177261100000099',
      violatedAt: '2026-11-01T10:20:00+03:00',
      amount: 3000,
      discountAmount: null,
      discountDeadline: null,
      paymentDeadline: '2027-01-25',
      description: 'Повторное нарушение: несоблюдение требований знаков',
      status: 'paid',
    });

    const car2Rows = await db.select().from(fines).where(eq(fines.carId, car2.id));
    expect(car2Rows).toHaveLength(1);
    expect(car2Rows[0].resolutionNumber).toBe('18810177261100000100');
  });

  it('rolls back all changes if a write fails mid-sync', async () => {
    const db = createDb(':memory:');
    const [car] = await db
      .insert(cars)
      .values({
        plate: 'К777ММ 777',
        brand: 'Kia',
        model: 'K5',
        status: 'in_rent',
        mileage: 45000,
      })
      .returning();

    await db.insert(fines).values({
      carId: car.id,
      resolutionNumber: '18810177261100000201',
      violatedAt: '2026-11-05T11:00:00+03:00',
      amount: 1000,
      discountAmount: 750,
      discountDeadline: '2026-12-05',
      paymentDeadline: '2027-01-14',
      description: 'Исходный штраф',
      status: 'unpaid',
    });

    const failingProvider: FinesProvider = {
      async fetchFinesByPlate() {
        return [
          {
            resolutionNumber: '18810177261100000201',
            violatedAt: '2026-11-05T11:00:00+03:00',
            amount: 9999,
            discountAmount: null,
            discountDeadline: null,
            paymentDeadline: '2027-01-14',
            description: 'Не должно сохраниться',
            status: 'paid',
          },
          {
            resolutionNumber: '18810177261100000202',
            violatedAt: '2026-11-06T12:00:00+03:00',
            amount: 500,
            discountAmount: null,
            discountDeadline: null,
            paymentDeadline: '2027-01-15',
            description: null as unknown as string,
            status: 'unpaid',
          },
        ];
      },
    };

    await expect(syncCarFines(db, car.id, car.plate, failingProvider)).rejects.toThrow();

    const rows = await db.select().from(fines).where(eq(fines.carId, car.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resolutionNumber: '18810177261100000201',
      amount: 1000,
      description: 'Исходный штраф',
      status: 'unpaid',
    });
  });

  it('uses default MockFinesProvider when provider argument is omitted', async () => {
    const db = createDb(':memory:');
    const [car] = await db
      .insert(cars)
      .values({
        plate: 'М321ТН 777',
        brand: 'Geely',
        model: 'Coolray',
        status: 'available',
        mileage: 34100,
      })
      .returning();

    const first = await syncCarFines(db, car.id, car.plate);
    const second = await syncCarFines(db, car.id, car.plate);
    const rows = await db.select().from(fines).where(eq(fines.carId, car.id));

    expect(first.inserted).toBeGreaterThanOrEqual(1);
    expect(first.inserted).toBeLessThanOrEqual(5);
    expect(first.updated).toBe(0);
    expect(second).toEqual({ inserted: 0, updated: first.inserted });
    expect(rows).toHaveLength(first.inserted);
  });

  it('passes stsNumber to provider, attributes driverId on insert/backfill, and preserves manual driverId while syncing status', async () => {
    const db = createDb(':memory:');
    const [car] = await db
      .insert(cars)
      .values({
        plate: 'Н555УХ 777',
        brand: 'Kia',
        model: 'Rio',
        status: 'in_rent',
        mileage: 75000,
        stsNumber: '99 01 123456',
      })
      .returning();

    const [driverA, driverB] = await db
      .insert(drivers)
      .values([
        { fullName: 'Иванов Алексей' },
        { fullName: 'Петров Олег' },
      ])
      .returning();

    await db.insert(rentals).values({
      carId: car.id,
      driverId: driverA.id,
      renterName: driverA.fullName,
      rateAmount: 2200,
      periodicity: 'daily',
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      active: false,
    });

    const receivedCalls: Array<{ plate: string; stsNumber: string | null | undefined }> = [];
    let payload: ExternalFine[] = [
      {
        resolutionNumber: '18810177261100000901',
        violatedAt: '2026-11-05T14:00:00+03:00',
        amount: 1000,
        discountAmount: 750,
        discountDeadline: '2026-12-05',
        paymentDeadline: '2027-01-14',
        description: 'Скорость на период аренды А',
        status: 'unpaid',
      },
      {
        resolutionNumber: '18810177261100000902',
        violatedAt: '2026-11-15T14:00:00+03:00',
        amount: 1500,
        discountAmount: null,
        discountDeadline: null,
        paymentDeadline: '2027-01-24',
        description: 'Штраф без аренды на момент первой синхронизации',
        status: 'unpaid',
      },
    ];

    const provider: FinesProvider = {
      async fetchFinesByPlate(plate, stsNumber) {
        receivedCalls.push({ plate, stsNumber });
        return payload;
      },
    };

    const first = await syncCarFines(db, car.id, car.plate, {
      stsNumber: car.stsNumber,
      provider,
    });
    expect(first).toEqual({ inserted: 2, updated: 0 });
    expect(receivedCalls).toEqual([{ plate: 'Н555УХ 777', stsNumber: '99 01 123456' }]);

    const afterFirst = await db.select().from(fines).where(eq(fines.carId, car.id));
    expect(afterFirst.find((f) => f.resolutionNumber === '18810177261100000901')?.driverId).toBe(
      driverA.id,
    );
    expect(afterFirst.find((f) => f.resolutionNumber === '18810177261100000902')?.driverId).toBeNull();

    // Manually reassign fine 901 to driverB, and add a rental for driverB covering 2026-11-15 so fine 902 can backfill.
    await db
      .update(fines)
      .set({ driverId: driverB.id })
      .where(eq(fines.resolutionNumber, '18810177261100000901'));

    await db.insert(rentals).values({
      carId: car.id,
      driverId: driverB.id,
      renterName: driverB.fullName,
      rateAmount: 2400,
      periodicity: 'daily',
      startDate: '2026-11-12',
      endDate: null,
      active: true,
    });

    payload = payload.map((item) =>
      item.resolutionNumber === '18810177261100000901'
        ? { ...item, status: 'paid' }
        : item,
    );

    const second = await syncCarFines(db, car.id, car.plate, {
      stsNumber: null,
      provider,
    });
    expect(second).toEqual({ inserted: 0, updated: 2 });
    expect(receivedCalls[1]).toEqual({ plate: 'Н555УХ 777', stsNumber: null });

    const afterSecond = await db.select().from(fines).where(eq(fines.carId, car.id));
    const fine901 = afterSecond.find((f) => f.resolutionNumber === '18810177261100000901');
    const fine902 = afterSecond.find((f) => f.resolutionNumber === '18810177261100000902');
    expect(fine901?.driverId).toBe(driverB.id);
    expect(fine901?.status).toBe('paid');
    expect(fine902?.driverId).toBe(driverB.id);
  });
});

describe('MockFinesProvider', () => {
  it('deterministically generates 1-5 realistic fines with 20-digit resolution numbers', async () => {
    const provider = new MockFinesProvider();
    const first = await provider.fetchFinesByPlate('А123ВС 777');
    const second = await provider.fetchFinesByPlate(' а123вс 777 ', '99 01 123456');
    const third = await provider.fetchFinesByPlate('А123ВС 777', null);
    const other = await provider.fetchFinesByPlate('К999МР 97');

    expect(first).toEqual(second);
    expect(first).toEqual(third);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(other).not.toEqual(first);

    for (const fine of first) {
      expect(fine.resolutionNumber).toMatch(/^\d{20}$/);
      expect(Number.isNaN(Date.parse(fine.violatedAt))).toBe(false);
      expect(fine.amount).toBeGreaterThan(0);
      expect(fine.paymentDeadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fine.description.length).toBeGreaterThan(5);
      expect(['unpaid', 'paid']).toContain(fine.status);
      if (fine.discountAmount !== null) {
        expect(fine.discountAmount).toBeLessThan(fine.amount);
        expect(fine.discountDeadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      } else {
        expect(fine.discountDeadline).toBeNull();
      }
    }
  });

  it('getFinesProvider returns MockFinesProvider by default', () => {
    expect(getFinesProvider()).toBeInstanceOf(MockFinesProvider);
  });
});
