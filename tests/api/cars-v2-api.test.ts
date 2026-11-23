import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppDb } from '@/db';
import {
  carDocuments,
  cars,
  drivers,
  fines,
  maintenanceParts,
  maintenanceRecords,
  rentalPayments,
  rentals,
  users,
} from '@/db/schema';
import { seedDatabase } from '@/db/seed';
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/session';
import * as finesProviderModule from '@/lib/fines/provider';
import { shiftUtcDaysIso } from '@/lib/format';
import { GET as listCarsGet, POST as createCarPost } from '@/app/api/cars/route';
import { GET as getCarDetailGet, PATCH as updateCarPatch } from '@/app/api/cars/[id]/route';
import { PUT as upsertRentalPut } from '@/app/api/cars/[id]/rental/route';
import { POST as endRentalPost } from '@/app/api/cars/[id]/rental/end/route';
import { POST as togglePaymentPost } from '@/app/api/cars/[id]/rental/payments/route';
import { POST as createFinePost } from '@/app/api/cars/[id]/fines/route';
import { POST as syncFinesPost } from '@/app/api/cars/[id]/fines/sync/route';
import { PATCH as updateFineStatusPatch } from '@/app/api/cars/[id]/fines/[fineId]/route';
import { PUT as upsertDocumentsPut } from '@/app/api/cars/[id]/documents/route';
import { PATCH as updateMaintenancePatch } from '@/app/api/cars/[id]/maintenance/[recordId]/route';

const mockState = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  db: null as AppDb | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockState.cookieJar.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
  }),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  const testDb = actual.createDb(':memory:');
  mockState.db = testDb;
  return {
    ...actual,
    db: testDb,
  };
});

function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function idCtx(id: number | string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: String(id) }) };
}

function fineCtx(
  id: number | string,
  fineId: number | string,
): { params: Promise<{ id: string; fineId: string }> } {
  return { params: Promise.resolve({ id: String(id), fineId: String(fineId) }) };
}

function maintCtx(
  id: number | string,
  recordId: number | string,
): { params: Promise<{ id: string; recordId: string }> } {
  return { params: Promise.resolve({ id: String(id), recordId: String(recordId) }) };
}

async function loginAs(role: 'admin' | 'viewer'): Promise<void> {
  const [user] = await mockState.db!.select().from(users).where(eq(users.role, role)).limit(1);
  const { token } = await createSession(mockState.db!, user.id);
  mockState.cookieJar.set(SESSION_COOKIE_NAME, token);
}

describe('Car v2 API routes (lifecycle, fines status, documents, maintenance edit, summary)', () => {
  beforeAll(async () => {
    if (!mockState.db) throw new Error('Test DB not initialized');
    await seedDatabase(mockState.db);
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockState.cookieJar.clear();
    const db = mockState.db!;
    await db.delete(carDocuments);
    await db.delete(maintenanceParts);
    await db.delete(maintenanceRecords);
    await db.delete(rentalPayments);
    await db.delete(rentals);
    await db.delete(fines);
    await db.delete(drivers);
    await db.delete(cars);
  });

  it('enforces 401/403 RBAC and validates route params & payloads on all new v2 endpoints', async () => {
    const db = mockState.db!;
    const [car] = await db
      .insert(cars)
      .values({ plate: 'А100АА 77', brand: 'Kia', model: 'Rio', status: 'in_rent', mileage: 50000 })
      .returning();
    const [fine] = await db
      .insert(fines)
      .values({
        carId: car.id,
        resolutionNumber: '18810177261100008801',
        violatedAt: '2026-11-10T10:00:00+03:00',
        amount: 1000,
        paymentDeadline: '2027-01-10',
        description: 'Скорость',
        status: 'unpaid',
      })
      .returning();
    const [record] = await db
      .insert(maintenanceRecords)
      .values({
        carId: car.id,
        title: 'ТО-50',
        performedAt: '2026-11-15',
        mileage: 50000,
        laborCost: 2000,
        totalCost: 2000,
      })
      .returning();

    // Unauthenticated -> 401
    expect((await endRentalPost(jsonReq('http://localhost/x', 'POST', {}), idCtx(car.id))).status).toBe(401);
    expect(
      (await updateFineStatusPatch(jsonReq('http://localhost/x', 'PATCH', { status: 'paid' }), fineCtx(car.id, fine.id)))
        .status,
    ).toBe(401);
    expect(
      (await upsertDocumentsPut(jsonReq('http://localhost/x', 'PUT', { documents: [] }), idCtx(car.id))).status,
    ).toBe(401);
    expect(
      (
        await updateMaintenancePatch(
          jsonReq('http://localhost/x', 'PATCH', {
            title: 'ТО',
            performedAt: '2026-11-15',
            mileage: 50000,
            laborCost: 1000,
            parts: [],
          }),
          maintCtx(car.id, record.id),
        )
      ).status,
    ).toBe(401);

    // Viewer -> 403
    await loginAs('viewer');
    const viewerResponses = await Promise.all([
      endRentalPost(jsonReq('http://localhost/x', 'POST', {}), idCtx(car.id)),
      updateFineStatusPatch(jsonReq('http://localhost/x', 'PATCH', { status: 'paid' }), fineCtx(car.id, fine.id)),
      upsertDocumentsPut(jsonReq('http://localhost/x', 'PUT', { documents: [] }), idCtx(car.id)),
      updateMaintenancePatch(
        jsonReq('http://localhost/x', 'PATCH', {
          title: 'ТО',
          performedAt: '2026-11-15',
          mileage: 50000,
          laborCost: 1000,
          parts: [],
        }),
        maintCtx(car.id, record.id),
      ),
    ]);
    for (const res of viewerResponses) {
      expect(res.status).toBe(403);
    }

    // Invalid IDs & payloads -> Russian 400
    await loginAs('admin');
    const badResults = await Promise.all([
      endRentalPost(jsonReq('http://localhost/x', 'POST', {}), idCtx('bad')),
      endRentalPost(jsonReq('http://localhost/x', 'POST', { endDate: '2026-02-31' }), idCtx(car.id)),
      upsertRentalPut(
        jsonReq('http://localhost/x', 'PUT', {
          renterName: '   ',
          rateAmount: 2000,
          periodicity: 'daily',
          startDate: '2026-11-10',
        }),
        idCtx(car.id),
      ),
      upsertRentalPut(
        jsonReq('http://localhost/x', 'PUT', {
          rateAmount: 2000,
          periodicity: 'daily',
          startDate: '2026-11-10',
        }),
        idCtx(car.id),
      ),
      updateFineStatusPatch(jsonReq('http://localhost/x', 'PATCH', { status: 'paid' }), fineCtx(car.id, '0')),
      updateFineStatusPatch(jsonReq('http://localhost/x', 'PATCH', { status: 'pending' }), fineCtx(car.id, fine.id)),
      upsertDocumentsPut(jsonReq('http://localhost/x', 'PUT', { documents: 'bad' }), idCtx(car.id)),
      updateMaintenancePatch(
        jsonReq('http://localhost/x', 'PATCH', {
          title: 'ТО',
          performedAt: '2026-11-15',
          mileage: 50000,
          laborCost: 1000,
          parts: [],
        }),
        maintCtx(car.id, '-1'),
      ),
      updateMaintenancePatch(jsonReq('http://localhost/x', 'PATCH', {}), maintCtx(car.id, record.id)),
    ]);
    for (const res of badResults) {
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    // Unknown carId / recordId / fineId -> 404
    expect((await endRentalPost(jsonReq('http://localhost/x', 'POST', {}), idCtx(9999))).status).toBe(404);
    expect((await upsertDocumentsPut(jsonReq('http://localhost/x', 'PUT', { documents: [] }), idCtx(9999))).status).toBe(404);
    expect((await updateFineStatusPatch(jsonReq('http://localhost/x', 'PATCH', { status: 'paid' }), fineCtx(9999, fine.id))).status).toBe(404);
    expect(
      (
        await updateMaintenancePatch(
          jsonReq('http://localhost/x', 'PATCH', {
            title: 'ТО',
            performedAt: '2026-11-15',
            mileage: 50000,
            laborCost: 1000,
            parts: [],
          }),
          maintCtx(car.id, 9999),
        )
      ).status,
    ).toBe(404);
  });

  it('creates, updates, clears, and forwards stsNumber into FinesProvider on sync', async () => {
    await loginAs('admin');

    const createRes = await createCarPost(
      jsonReq('http://localhost/api/cars', 'POST', {
        plate: 'К111МР 777',
        brand: 'Kia',
        model: 'K5',
        status: 'available',
        mileage: 25000,
        stsNumber: ' 99 01 123456 ',
      }),
    );
    expect(createRes.status).toBe(201);
    const { car: created } = (await createRes.json()) as {
      car: { id: number; stsNumber: string | null; deadlineStatus: string; urgentDeadlinesCount: number };
    };
    expect(created.stsNumber).toBe('99 01 123456');
    expect(created.deadlineStatus).toBe('ok');
    expect(created.urgentDeadlinesCount).toBe(0);

    // Partial PATCH preserves stsNumber
    const patchMileage = await updateCarPatch(
      jsonReq('http://localhost/api/cars', 'PATCH', { mileage: 26000 }),
      idCtx(created.id),
    );
    expect(patchMileage.status).toBe(200);
    expect(((await patchMileage.json()) as { car: { stsNumber: string | null } }).car.stsNumber).toBe(
      '99 01 123456',
    );

    const fetchSpy = vi.fn().mockResolvedValue([
      {
        resolutionNumber: '18810177261100007701',
        violatedAt: '2026-11-18T12:00:00+03:00',
        amount: 1000,
        discountAmount: 750,
        discountDeadline: '2026-12-18',
        paymentDeadline: '2027-01-27',
        description: 'Тестовый штраф по СТС',
        status: 'unpaid',
      },
    ]);
    vi.spyOn(finesProviderModule, 'getFinesProvider').mockReturnValue({
      fetchFinesByPlate: fetchSpy,
    });

    const syncRes = await syncFinesPost(
      new Request('http://localhost/api/cars/1/fines/sync', { method: 'POST' }),
      idCtx(created.id),
    );
    expect(syncRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith('К111МР 777', '99 01 123456');

    // Clear stsNumber with blank string
    const clearSts = await updateCarPatch(
      jsonReq('http://localhost/api/cars', 'PATCH', { stsNumber: '   ' }),
      idCtx(created.id),
    );
    expect(clearSts.status).toBe(200);
    expect(((await clearSts.json()) as { car: { stsNumber: string | null } }).car.stsNumber).toBeNull();

    const detailRes = await getCarDetailGet(new Request('http://localhost/api/cars'), idCtx(created.id));
    expect(detailRes.status).toBe(200);
    expect(((await detailRes.json()) as { car: { stsNumber: string | null } }).car.stsNumber).toBeNull();
  });

  it('handles driverId rental lifecycle, same-day & backdated switches, archived rejection, auto status, and /rental/end', async () => {
    await loginAs('admin');
    const db = mockState.db!;

    const [driverA, driverB, driverC, archivedDriver] = await db
      .insert(drivers)
      .values([
        { fullName: 'Иванов Алексей', phone: '+7 916 111-11-11' },
        { fullName: 'Петров Олег', phone: '+7 925 222-22-22' },
        { fullName: 'Сидоров Дмитрий', phone: null },
        { fullName: 'Архивный Водитель', archived: true },
      ])
      .returning();

    const [carAvail, carRepair] = await db
      .insert(cars)
      .values([
        { plate: 'А222ВС 777', brand: 'Kia', model: 'Rio', status: 'available', mileage: 40000 },
        { plate: 'Е333КХ 777', brand: 'Skoda', model: 'Octavia', status: 'in_repair', mileage: 90000 },
      ])
      .returning();

    const todayIso = new Date().toISOString().slice(0, 10);
    const dayMinus10 = shiftUtcDaysIso(todayIso, -10);
    const dayMinus9 = shiftUtcDaysIso(todayIso, -9);
    const dayMinus5 = shiftUtcDaysIso(todayIso, -5);
    const dayMinus6 = shiftUtcDaysIso(todayIso, -6);

    // Assigning archived driver -> 400
    const archivedRes = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: archivedDriver.id,
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: dayMinus10,
      }),
      idCtx(carAvail.id),
    );
    expect(archivedRes.status).toBe(400);

    // Assigning driverA without renterName -> creates active rental & transitions available -> in_rent
    const assignARes = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverA.id,
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: dayMinus10,
      }),
      idCtx(carAvail.id),
    );
    expect(assignARes.status).toBe(200);
    const { rental: rA } = (await assignARes.json()) as {
      rental: { id: number; driverId: number; renterName: string; driverPhone: string | null; active: boolean };
    };
    expect(rA).toMatchObject({
      driverId: driverA.id,
      renterName: 'Иванов Алексей',
      driverPhone: '+7 916 111-11-11',
      active: true,
    });
    expect((await db.select().from(cars).where(eq(cars.id, carAvail.id)))[0].status).toBe('in_rent');

    // Switch to driverB with newStartDate > old.startDate (dayMinus5) -> closes rA at dayMinus6
    const switchBRes = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverB.id,
        rateAmount: 2300,
        periodicity: 'daily',
        startDate: dayMinus5,
      }),
      idCtx(carAvail.id),
    );
    expect(switchBRes.status).toBe(200);
    const [closedA] = await db.select().from(rentals).where(eq(rentals.id, rA.id));
    expect(closedA.active).toBe(false);
    expect(closedA.endDate).toBe(dayMinus6);

    // Switch to driverC with backdated newStartDate < old.startDate (dayMinus9 < dayMinus5)
    // Review Focus #2: closed endDate must be old.startDate (dayMinus5), never < startDate!
    const switchCBackdated = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverC.id,
        rateAmount: 2500,
        periodicity: 'daily',
        startDate: dayMinus9,
      }),
      idCtx(carAvail.id),
    );
    expect(switchCBackdated.status).toBe(200);
    const { rental: rC } = (await switchCBackdated.json()) as { rental: { id: number; startDate: string } };

    const allCarRentals = await db.select().from(rentals).where(eq(rentals.carId, carAvail.id));
    expect(allCarRentals).toHaveLength(3);
    expect(allCarRentals.filter((r) => r.active)).toHaveLength(1);
    const closedB = allCarRentals.find((r) => r.driverId === driverB.id)!;
    expect(closedB.active).toBe(false);
    expect(closedB.endDate).toBe(dayMinus5);
    expect(closedB.endDate! >= closedB.startDate).toBe(true);

    // Same-day switch (newStartDate === old.startDate) -> old endDate === old.startDate
    const switchSameDay = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverA.id,
        rateAmount: 2600,
        periodicity: 'daily',
        startDate: rC.startDate,
      }),
      idCtx(carAvail.id),
    );
    expect(switchSameDay.status).toBe(200);
    const { rental: rA2 } = (await switchSameDay.json()) as { rental: { id: number; startDate: string } };
    const [closedC] = await db.select().from(rentals).where(eq(rentals.id, rC.id));
    expect(closedC.active).toBe(false);
    expect(closedC.endDate).toBe(rC.startDate);

    // Same driverId updates in place (preserves rental.id)
    const updateSameDriver = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverA.id,
        rateAmount: 2700,
        periodicity: 'daily',
        startDate: rA2.startDate,
      }),
      idCtx(carAvail.id),
    );
    expect(updateSameDriver.status).toBe(200);
    expect(((await updateSameDriver.json()) as { rental: { id: number; rateAmount: number } }).rental).toMatchObject({
      id: rA2.id,
      rateAmount: 2700,
    });

    // Next-day switch (newStartDate === old.startDate + 1d) -> old endDate === old.startDate
    const nextDayIso = shiftUtcDaysIso(rA2.startDate, 1);
    const switchNextDay = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverB.id,
        rateAmount: 2800,
        periodicity: 'daily',
        startDate: nextDayIso,
      }),
      idCtx(carAvail.id),
    );
    expect(switchNextDay.status).toBe(200);
    const [closedA2] = await db.select().from(rentals).where(eq(rentals.id, rA2.id));
    expect(closedA2.active).toBe(false);
    expect(closedA2.endDate).toBe(rA2.startDate);

    // Unknown driverId -> 404
    expect(
      (
        await upsertRentalPut(
          jsonReq('http://localhost/x', 'PUT', {
            driverId: 999999,
            rateAmount: 2000,
            periodicity: 'daily',
            startDate: todayIso,
          }),
          idCtx(carAvail.id),
        )
      ).status,
    ).toBe(404);

    // /rental/end rejects endDate < activeRental.startDate
    const badEndRes = await endRentalPost(
      jsonReq('http://localhost/x', 'POST', { endDate: dayMinus10 }),
      idCtx(carAvail.id),
    );
    expect(badEndRes.status).toBe(400);

    // /rental/end closes active rental and resets in_rent -> available
    const okEndRes = await endRentalPost(
      jsonReq('http://localhost/x', 'POST', { endDate: todayIso }),
      idCtx(carAvail.id),
    );
    expect(okEndRes.status).toBe(200);
    const okEndBody = (await okEndRes.json()) as {
      rental: { active: boolean; endDate: string | null };
      carStatus: string;
    };
    expect(okEndBody.rental.active).toBe(false);
    expect(okEndBody.rental.endDate).toBe(todayIso);
    expect(okEndBody.carStatus).toBe('available');
    expect((await db.select().from(cars).where(eq(cars.id, carAvail.id)))[0].status).toBe('available');

    // Second /rental/end with no active rental -> 404
    expect((await endRentalPost(jsonReq('http://localhost/x', 'POST', {}), idCtx(carAvail.id))).status).toBe(404);

    // in_repair car keeps in_repair on both assignment and /rental/end
    const repairAssign = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverA.id,
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: dayMinus5,
      }),
      idCtx(carRepair.id),
    );
    expect(repairAssign.status).toBe(200);
    expect((await db.select().from(cars).where(eq(cars.id, carRepair.id)))[0].status).toBe('in_repair');

    const repairEnd = await endRentalPost(jsonReq('http://localhost/x', 'POST', {}), idCtx(carRepair.id));
    expect(repairEnd.status).toBe(200);
    expect(((await repairEnd.json()) as { carStatus: string }).carStatus).toBe('in_repair');

    // /rental/end with omitted body defaults endDate to todayIso
    const futureStart = shiftUtcDaysIso(todayIso, 3);
    const futureAssign = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverA.id,
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: futureStart,
      }),
      idCtx(carAvail.id),
    );
    expect(futureAssign.status).toBe(200);
    // Future startDate > todayIso keeps available status
    expect((await db.select().from(cars).where(eq(cars.id, carAvail.id)))[0].status).toBe('available');

    // Close via active: false on PUT /rental (sets endDate = max(startDate, todayIso) and resets in_rent -> available)
    const closeViaPut = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverA.id,
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: futureStart,
        active: false,
      }),
      idCtx(carAvail.id),
    );
    expect(closeViaPut.status).toBe(200);
    expect(((await closeViaPut.json()) as { rental: { active: boolean; endDate: string } }).rental).toMatchObject({
      active: false,
      endDate: futureStart,
    });

    // Empty body POST /rental/end defaults endDate to todayIso
    await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driverA.id,
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: dayMinus5,
      }),
      idCtx(carAvail.id),
    );
    const emptyBodyEnd = await endRentalPost(
      new Request('http://localhost/x', { method: 'POST' }),
      idCtx(carAvail.id),
    );
    expect(emptyBodyEnd.status).toBe(200);
    expect(((await emptyBodyEnd.json()) as { rental: { endDate: string }; carStatus: string })).toMatchObject({
      rental: { endDate: todayIso },
      carStatus: 'available',
    });

    // Detail on carAvail shows rental === null, sorted rentalHistory, and rentDebt30d from closed rentals
    const detailRes = await getCarDetailGet(new Request('http://localhost/api/cars'), idCtx(carAvail.id));
    expect(detailRes.status).toBe(200);
    const { car: detail } = (await detailRes.json()) as {
      car: {
        rental: null;
        activeDriverId: number | null;
        activeDriverName: string | null;
        rentDebt30d: number;
        rentalHistory: Array<{ id: number; active: boolean; endDate: string | null; rentDebt30d: number }>;
      };
    };
    expect(detail.rental).toBeNull();
    expect(detail.activeDriverId).toBeNull();
    expect(detail.activeDriverName).toBeNull();
    expect(detail.rentalHistory).toHaveLength(7);
    expect(detail.rentDebt30d).toBeGreaterThan(0);
  });

  it('guards cross-car IDs with 404 on rental/payments, fines/[fineId], and maintenance/[recordId], and executes valid mutations', async () => {
    await loginAs('admin');
    const db = mockState.db!;

    const [carA, carB] = await db
      .insert(cars)
      .values([
        { plate: 'А111АА 777', brand: 'Kia', model: 'Rio', status: 'in_rent', mileage: 100000 },
        { plate: 'В222ВВ 777', brand: 'Hyundai', model: 'Solaris', status: 'in_rent', mileage: 80000 },
      ])
      .returning();

    const [driverA] = await db.insert(drivers).values([{ fullName: 'Водитель А' }]).returning();
    const todayIso = new Date().toISOString().slice(0, 10);
    const startIso = shiftUtcDaysIso(todayIso, -5);

    const [rentalA, rentalB] = await db
      .insert(rentals)
      .values([
        {
          carId: carA.id,
          driverId: driverA.id,
          renterName: driverA.fullName,
          rateAmount: 2000,
          periodicity: 'daily',
          startDate: startIso,
          endDate: shiftUtcDaysIso(todayIso, -2),
          active: false,
        },
        {
          carId: carB.id,
          driverId: driverA.id,
          renterName: driverA.fullName,
          rateAmount: 3000,
          periodicity: 'daily',
          startDate: startIso,
          endDate: null,
          active: true,
        },
      ])
      .returning();

    const [fineB] = await db
      .insert(fines)
      .values({
        carId: carB.id,
        resolutionNumber: '18810177261100009901',
        violatedAt: `${startIso}T10:00:00+03:00`,
        amount: 1500,
        paymentDeadline: '2027-01-20',
        description: 'Штраф машины B',
        status: 'unpaid',
      })
      .returning();

    const [maintB] = await db
      .insert(maintenanceRecords)
      .values({
        carId: carB.id,
        title: 'ТО машины B',
        performedAt: startIso,
        mileage: 80000,
        laborCost: 1000,
        totalCost: 1000,
      })
      .returning();

    // Cross-car guards -> 404 (Review Focus #5)
    expect(
      (
        await togglePaymentPost(
          jsonReq('http://localhost/x', 'POST', { dueDate: startIso, paid: true, rentalId: rentalB.id }),
          idCtx(carA.id),
        )
      ).status,
    ).toBe(404);

    expect(
      (await updateFineStatusPatch(jsonReq('http://localhost/x', 'PATCH', { status: 'paid' }), fineCtx(carA.id, fineB.id)))
        .status,
    ).toBe(404);

    expect(
      (
        await updateMaintenancePatch(
          jsonReq('http://localhost/x', 'PATCH', {
            title: 'Взлом ТО B',
            performedAt: todayIso,
            mileage: 999999,
            laborCost: 5000,
            parts: [],
          }),
          maintCtx(carA.id, maintB.id),
        )
      ).status,
    ).toBe(404);

    // Explicit rentalId on carA (closed rental) works cleanly
    const payClosedA = await togglePaymentPost(
      jsonReq('http://localhost/x', 'POST', { dueDate: startIso, paid: true, rentalId: rentalA.id }),
      idCtx(carA.id),
    );
    expect(payClosedA.status).toBe(200);

    // Auto driver attribution on manual fine creation + explicit driverId + status toggle
    const autoFineRes = await createFinePost(
      jsonReq('http://localhost/x', 'POST', {
        resolutionNumber: '18810177261100009902',
        violatedAt: `${startIso}T12:00:00+03:00`,
        amount: 2500,
        paymentDeadline: '2027-01-25',
        description: 'Автопривязанный штраф',
      }),
      idCtx(carB.id),
    );
    expect(autoFineRes.status).toBe(201);
    const { fine: autoFine } = (await autoFineRes.json()) as {
      fine: { id: number; driverId: number | null; driverName: string | null; status: string };
    };
    expect(autoFine.driverId).toBe(driverA.id);
    expect(autoFine.driverName).toBe('Водитель А');

    const toggleFinePaid = await updateFineStatusPatch(
      jsonReq('http://localhost/x', 'PATCH', { status: 'paid' }),
      fineCtx(carB.id, fineB.id),
    );
    expect(toggleFinePaid.status).toBe(200);
    expect(((await toggleFinePaid.json()) as { fine: { status: string } }).fine.status).toBe('paid');

    // Toggle back to unpaid and verify explicit driverId + unknown driverId 404 on POST /fines
    const toggleFineUnpaid = await updateFineStatusPatch(
      jsonReq('http://localhost/x', 'PATCH', { status: 'unpaid' }),
      fineCtx(carB.id, fineB.id),
    );
    expect(toggleFineUnpaid.status).toBe(200);
    expect(((await toggleFineUnpaid.json()) as { fine: { status: string } }).fine.status).toBe('unpaid');

    const [driverB] = await db.insert(drivers).values([{ fullName: 'Водитель Б' }]).returning();
    const explicitFineRes = await createFinePost(
      jsonReq('http://localhost/x', 'POST', {
        driverId: driverB.id,
        resolutionNumber: '18810177261100009903',
        violatedAt: `${startIso}T14:00:00+03:00`,
        amount: 500,
        paymentDeadline: '2027-01-25',
        description: 'Явный водитель',
      }),
      idCtx(carB.id),
    );
    expect(explicitFineRes.status).toBe(201);
    expect(((await explicitFineRes.json()) as { fine: { driverId: number; driverName: string } }).fine).toMatchObject({
      driverId: driverB.id,
      driverName: 'Водитель Б',
    });

    expect(
      (
        await createFinePost(
          jsonReq('http://localhost/x', 'POST', {
            driverId: 999999,
            resolutionNumber: '18810177261100009904',
            violatedAt: `${startIso}T14:00:00+03:00`,
            amount: 500,
            paymentDeadline: '2027-01-25',
            description: 'Несуществующий водитель',
          }),
          idCtx(carB.id),
        )
      ).status,
    ).toBe(404);

    // Maintenance edit updates parts, recalculates totalCost, and keeps car.mileage monotonic
    const maintEditUp = await updateMaintenancePatch(
      jsonReq('http://localhost/x', 'PATCH', {
        title: 'ТО-85: колодки и масло',
        performedAt: todayIso,
        mileage: 85000,
        laborCost: 3000,
        notes: 'Обновлено',
        parts: [{ name: 'Масло 5W-30', sku: 'OIL-1', quantity: 2, unitPrice: 1200 }],
      }),
      maintCtx(carB.id, maintB.id),
    );
    expect(maintEditUp.status).toBe(200);
    const { record: edited1 } = (await maintEditUp.json()) as {
      record: { title: string; totalCost: number; parts: Array<{ name: string; quantity: number }> };
    };
    expect(edited1.title).toBe('ТО-85: колодки и масло');
    expect(edited1.totalCost).toBe(5400);
    expect(edited1.parts).toHaveLength(1);
    expect((await db.select().from(cars).where(eq(cars.id, carB.id)))[0].mileage).toBe(85000);

    // Lower mileage in edit does NOT roll back car.mileage
    const maintEditLower = await updateMaintenancePatch(
      jsonReq('http://localhost/x', 'PATCH', {
        title: 'ТО-79: ретроспективная правка',
        performedAt: startIso,
        mileage: 79000,
        laborCost: 1500,
        notes: '',
        parts: [],
      }),
      maintCtx(carB.id, maintB.id),
    );
    expect(maintEditLower.status).toBe(200);
    const { record: edited2 } = (await maintEditLower.json()) as {
      record: { totalCost: number; notes: string | null; parts: unknown[] };
    };
    expect(edited2.totalCost).toBe(1500);
    expect(edited2.notes).toBeNull();
    expect(edited2.parts).toHaveLength(0);
    expect((await db.select().from(cars).where(eq(cars.id, carB.id)))[0].mileage).toBe(85000);
  });

  it('upserts/deletes documents via PUT /documents and aggregates 30d fleet KPIs in GET /api/cars', async () => {
    await loginAs('admin');
    const db = mockState.db!;

    const todayIso = new Date().toISOString().slice(0, 10);
    const soonIso = shiftUtcDaysIso(todayIso, 5);
    const expiredIso = shiftUtcDaysIso(todayIso, -2);
    const okIso = shiftUtcDaysIso(todayIso, 60);
    const dayMinus2 = shiftUtcDaysIso(todayIso, -2);
    const dayMinus1 = shiftUtcDaysIso(todayIso, -1);
    const oldOutsideWindow = shiftUtcDaysIso(todayIso, -35);

    const [car1, car2] = await db
      .insert(cars)
      .values([
        { plate: 'А100АА 777', brand: 'Kia', model: 'Rio', status: 'in_rent', mileage: 100000 },
        { plate: 'В200ВВ 777', brand: 'Hyundai', model: 'Solaris', status: 'available', mileage: 50000 },
      ])
      .returning();

    // Put documents on car1 (1 warning + 1 expired) -> urgentDeadlineCarsCount = 1
    const docsRes1 = await upsertDocumentsPut(
      jsonReq('http://localhost/x', 'PUT', {
        nextServiceMileage: 100500,
        nextServiceDate: soonIso,
        documents: [
          { type: 'kasko', expiresAt: okIso, policyNumber: 'K-1', notes: null },
          { type: 'osago', expiresAt: expiredIso, policyNumber: 'O-1', notes: 'Просрочено' },
          { type: 'tech_inspection', expiresAt: soonIso, policyNumber: '', notes: '' },
        ],
      }),
      idCtx(car1.id),
    );
    expect(docsRes1.status).toBe(200);
    const docsBody1 = (await docsRes1.json()) as {
      documents: Array<{ type: string; status: string }>;
      deadlines: { status: string; urgentDeadlinesCount: number };
      nextServiceMileage: number | null;
      nextServiceDate: string | null;
    };
    expect(docsBody1.documents.map((d) => [d.type, d.status])).toEqual([
      ['osago', 'expired'],
      ['tech_inspection', 'warning'],
      ['kasko', 'ok'],
    ]);
    expect(docsBody1.deadlines.status).toBe('expired');
    expect(docsBody1.deadlines.urgentDeadlinesCount).toBe(4);
    expect(docsBody1.nextServiceMileage).toBe(100500);
    expect(docsBody1.nextServiceDate).toBe(soonIso);

    // Replace documents omitting tech_inspection and kasko -> deletes omitted types
    const docsRes2 = await upsertDocumentsPut(
      jsonReq('http://localhost/x', 'PUT', {
        nextServiceMileage: 120000,
        nextServiceDate: okIso,
        documents: [{ type: 'osago', expiresAt: soonIso, policyNumber: 'O-2', notes: null }],
      }),
      idCtx(car1.id),
    );
    expect(docsRes2.status).toBe(200);
    const docsBody2 = (await docsRes2.json()) as {
      documents: Array<{ type: string; status: string }>;
      deadlines: { status: string; urgentDeadlinesCount: number };
    };
    expect(docsBody2.documents).toHaveLength(1);
    expect(docsBody2.documents[0]).toMatchObject({ type: 'osago', status: 'warning' });
    expect(docsBody2.deadlines.status).toBe('warning');
    expect(docsBody2.deadlines.urgentDeadlinesCount).toBe(1);

    // Seed rentals, payments, fines, maintenance to verify GET /api/cars summary
    const [driver] = await db.insert(drivers).values([{ fullName: 'Смирнов Д.П.' }]).returning();
    const [r1] = await db
      .insert(rentals)
      .values({
        carId: car1.id,
        driverId: driver.id,
        renterName: driver.fullName,
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: dayMinus2,
        endDate: null,
        active: true,
      })
      .returning();

    // Paid dayMinus2 (2000), unpaid dayMinus1 (overdue 2000), today upcoming, plus old payment outside 30d window
    await db.insert(rentalPayments).values([
      { rentalId: r1.id, dueDate: dayMinus2, amount: 2000, paidAt: `${dayMinus2}T10:00:00Z` },
      { rentalId: r1.id, dueDate: oldOutsideWindow, amount: 9000, paidAt: `${oldOutsideWindow}T10:00:00Z` },
    ]);
    await db.insert(fines).values([
      {
        carId: car1.id,
        resolutionNumber: '18810177261100003301',
        violatedAt: `${dayMinus1}T10:00:00+03:00`,
        amount: 1500,
        paymentDeadline: '2027-01-20',
        description: 'Неоплаченный',
        status: 'unpaid',
      },
      {
        carId: car2.id,
        resolutionNumber: '18810177261100003302',
        violatedAt: `${dayMinus1}T11:00:00+03:00`,
        amount: 500,
        paymentDeadline: '2027-01-20',
        description: 'Оплаченный',
        status: 'paid',
      },
    ]);
    await db.insert(maintenanceRecords).values([
      {
        carId: car2.id,
        title: 'ТО в окне',
        performedAt: dayMinus1,
        mileage: 50000,
        laborCost: 5000,
        totalCost: 5000,
      },
      {
        carId: car2.id,
        title: 'Старое ТО вне окна',
        performedAt: oldOutsideWindow,
        mileage: 45000,
        laborCost: 50000,
        totalCost: 50000,
      },
    ]);

    const listRes = await listCarsGet();
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      cars: Array<{
        id: number;
        unpaidFinesSum: number;
        rentDebt30d: number;
        activeDriverName: string | null;
        deadlineStatus: string;
        urgentDeadlinesCount: number;
      }>;
      summary: {
        totalRentDebt30d: number;
        totalUnpaidFinesSum: number;
        totalUnpaidFinesCount: number;
        paidRental30d: number;
        managerIncome30d: number;
        paidRentalMonth: number;
        managerIncomeMonth: number;
        maintenanceCost30d: number;
        netIncome30d: number;
        urgentDeadlineCarsCount: number;
      };
    };

    const expectedPaidRentalMonth = dayMinus2 >= `${todayIso.slice(0, 7)}-01` ? 2000 : 0;
    expect(listBody.summary).toEqual({
      totalRentDebt30d: 2000,
      totalUnpaidFinesSum: 1500,
      totalUnpaidFinesCount: 1,
      paidRental30d: 2000,
      managerIncome30d: 0,
      paidRentalMonth: expectedPaidRentalMonth,
      managerIncomeMonth: 0,
      maintenanceCost30d: 5000,
      netIncome30d: -3000,
      urgentDeadlineCarsCount: 1,
    });

    const summaryCar1 = listBody.cars.find((c) => c.id === car1.id)!;
    expect(summaryCar1).toMatchObject({
      unpaidFinesSum: 1500,
      rentDebt30d: 2000,
      activeDriverName: 'Смирнов Д.П.',
      deadlineStatus: 'warning',
      urgentDeadlinesCount: 1,
    });

    // GET /api/cars/[id] returns documents, deadlines, activeDriverName, timeline, and fines
    const car1DetailRes = await getCarDetailGet(new Request('http://localhost/api/cars'), idCtx(car1.id));
    expect(car1DetailRes.status).toBe(200);
    const { car: car1Detail } = (await car1DetailRes.json()) as {
      car: {
        documents: Array<{ type: string }>;
        deadlines: { status: string; urgentDeadlinesCount: number };
        timeline: Array<{ dueDate: string; status: string }>;
      };
    };
    expect(car1Detail.documents.map((d) => d.type)).toEqual(['osago']);
    expect(car1Detail.deadlines.status).toBe('warning');
    expect(car1Detail.timeline.length).toBeGreaterThanOrEqual(2);

    // Passing documents: [] clears all documents on car1
    const clearDocsRes = await upsertDocumentsPut(
      jsonReq('http://localhost/x', 'PUT', {
        nextServiceMileage: null,
        nextServiceDate: null,
        documents: [],
      }),
      idCtx(car1.id),
    );
    expect(clearDocsRes.status).toBe(200);
    const clearedBody = (await clearDocsRes.json()) as {
      documents: unknown[];
      deadlines: { status: string; urgentDeadlinesCount: number };
    };
    expect(clearedBody.documents).toEqual([]);
    expect(clearedBody.deadlines.status).toBe('ok');
    expect(clearedBody.deadlines.urgentDeadlinesCount).toBe(0);
  });

  it('persists, defaults, reads back, and validates managerCommissionPercent on PUT /api/cars/[id]/rental and GET /api/cars/[id]', async () => {
    await loginAs('admin');
    const db = mockState.db!;

    const [car] = await db
      .insert(cars)
      .values({ plate: 'К555КК 777', brand: 'Kia', model: 'Rio', status: 'available', mileage: 25000 })
      .returning();
    const [driver] = await db
      .insert(drivers)
      .values({ fullName: 'Волков Сергей Иванович', phone: '+7 916 555-55-55' })
      .returning();

    const todayIso = new Date().toISOString().slice(0, 10);

    // 1. Omitted managerCommissionPercent defaults to 0
    const defaultRes = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driver.id,
        rateAmount: 2200,
        periodicity: 'daily',
        startDate: todayIso,
      }),
      idCtx(car.id),
    );
    expect(defaultRes.status).toBe(200);
    const defaultBody = (await defaultRes.json()) as {
      rental: { managerCommissionPercent: number };
    };
    expect(defaultBody.rental.managerCommissionPercent).toBe(0);

    // 2. Saving integer 15
    const intRes = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driver.id,
        rateAmount: 2200,
        periodicity: 'daily',
        startDate: todayIso,
        managerCommissionPercent: 15,
      }),
      idCtx(car.id),
    );
    expect(intRes.status).toBe(200);
    const intBody = (await intRes.json()) as {
      rental: { managerCommissionPercent: number };
    };
    expect(intBody.rental.managerCommissionPercent).toBe(15);

    // Reading back via GET /api/cars/[id] (rental & rentalHistory)
    const detailAfterInt = await getCarDetailGet(new Request('http://localhost/api/cars'), idCtx(car.id));
    expect(detailAfterInt.status).toBe(200);
    const detailIntBody = (await detailAfterInt.json()) as {
      car: {
        rental: { managerCommissionPercent: number } | null;
        rentalHistory: Array<{ managerCommissionPercent: number }>;
      };
    };
    expect(detailIntBody.car.rental?.managerCommissionPercent).toBe(15);
    expect(detailIntBody.car.rentalHistory[0]?.managerCommissionPercent).toBe(15);

    // 3. Saving decimal 12.5
    const decimalRes = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driver.id,
        rateAmount: 2200,
        periodicity: 'daily',
        startDate: todayIso,
        managerCommissionPercent: 12.5,
      }),
      idCtx(car.id),
    );
    expect(decimalRes.status).toBe(200);
    const decimalBody = (await decimalRes.json()) as {
      rental: { managerCommissionPercent: number };
    };
    expect(decimalBody.rental.managerCommissionPercent).toBe(12.5);

    const detailAfterDecimal = await getCarDetailGet(new Request('http://localhost/api/cars'), idCtx(car.id));
    expect(detailAfterDecimal.status).toBe(200);
    const detailDecimalBody = (await detailAfterDecimal.json()) as {
      car: {
        rental: { managerCommissionPercent: number } | null;
        rentalHistory: Array<{ managerCommissionPercent: number }>;
      };
    };
    expect(detailDecimalBody.car.rental?.managerCommissionPercent).toBe(12.5);
    expect(detailDecimalBody.car.rentalHistory[0]?.managerCommissionPercent).toBe(12.5);

    // 4. Rejecting < 0 and > 100 with 400 and Russian error message
    const negativeRes = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driver.id,
        rateAmount: 2200,
        periodicity: 'daily',
        startDate: todayIso,
        managerCommissionPercent: -1,
      }),
      idCtx(car.id),
    );
    expect(negativeRes.status).toBe(400);
    const negativeBody = (await negativeRes.json()) as { error: string };
    expect(negativeBody.error).toContain('Процент менеджера не может быть меньше 0');

    const overRes = await upsertRentalPut(
      jsonReq('http://localhost/x', 'PUT', {
        driverId: driver.id,
        rateAmount: 2200,
        periodicity: 'daily',
        startDate: todayIso,
        managerCommissionPercent: 100.5,
      }),
      idCtx(car.id),
    );
    expect(overRes.status).toBe(400);
    const overBody = (await overRes.json()) as { error: string };
    expect(overBody.error).toContain('Процент менеджера не может быть больше 100');
  });
});
