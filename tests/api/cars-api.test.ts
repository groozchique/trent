import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { cars, fines, maintenanceParts, maintenanceRecords, rentalPayments, rentals, users } from '@/db/schema';
import { seedDatabase } from '@/db/seed';
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/session';
import { handleApiError } from '@/lib/cars';
import { createCarSchema, updateCarSchema, upsertRentalSchema } from '@/lib/validation';
import { GET as listCarsGet, POST as createCarPost } from '@/app/api/cars/route';
import {
  DELETE as deleteCarDelete,
  GET as getCarDetailGet,
  PATCH as updateCarPatch,
} from '@/app/api/cars/[id]/route';
import { POST as createFinePost } from '@/app/api/cars/[id]/fines/route';
import { POST as syncFinesPost } from '@/app/api/cars/[id]/fines/sync/route';
import { PUT as upsertRentalPut } from '@/app/api/cars/[id]/rental/route';
import { POST as togglePaymentPost } from '@/app/api/cars/[id]/rental/payments/route';
import { POST as createMaintenancePost } from '@/app/api/cars/[id]/maintenance/route';

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

function rawReq(url: string, method: string, rawBody: string): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
}

function idCtx(id: number | string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: String(id) }) };
}

async function loginAs(role: 'admin' | 'viewer'): Promise<void> {
  const [user] = await mockState.db!.select().from(users).where(eq(users.role, role)).limit(1);
  const { token } = await createSession(mockState.db!, user.id);
  mockState.cookieJar.set(SESSION_COOKIE_NAME, token);
}

describe('Fleet, fines, rental & maintenance API routes', () => {
  beforeAll(async () => {
    if (!mockState.db) throw new Error('Test DB not initialized');
    await seedDatabase(mockState.db);
  });

  beforeEach(async () => {
    mockState.cookieJar.clear();
    const db = mockState.db!;
    await db.delete(maintenanceParts);
    await db.delete(maintenanceRecords);
    await db.delete(rentalPayments);
    await db.delete(rentals);
    await db.delete(fines);
    await db.delete(cars);
  });

  it('returns 401 for unauthenticated requests and 403 for viewer on all write endpoints', async () => {
    const [car] = await mockState.db!
      .insert(cars)
      .values({
        plate: 'А100АА 77',
        brand: 'Kia',
        model: 'Rio',
        status: 'available',
        mileage: 50000,
      })
      .returning();

    expect((await listCarsGet()).status).toBe(401);
    expect((await getCarDetailGet(new Request('http://localhost/api/cars/1'), idCtx(car.id))).status).toBe(401);
    expect((await createCarPost(jsonReq('http://localhost/api/cars', 'POST', {}))).status).toBe(401);
    expect((await updateCarPatch(jsonReq('http://localhost/api/cars/1', 'PATCH', {}), idCtx(car.id))).status).toBe(401);
    expect((await deleteCarDelete(new Request('http://localhost/api/cars/1', { method: 'DELETE' }), idCtx(car.id))).status).toBe(401);
    expect((await createFinePost(jsonReq('http://localhost/api/cars/1/fines', 'POST', {}), idCtx(car.id))).status).toBe(401);
    expect((await syncFinesPost(new Request('http://localhost/api/cars/1/fines/sync', { method: 'POST' }), idCtx(car.id))).status).toBe(401);
    expect((await upsertRentalPut(jsonReq('http://localhost/api/cars/1/rental', 'PUT', {}), idCtx(car.id))).status).toBe(401);
    expect((await togglePaymentPost(jsonReq('http://localhost/api/cars/1/rental/payments', 'POST', {}), idCtx(car.id))).status).toBe(401);
    expect((await createMaintenancePost(jsonReq('http://localhost/api/cars/1/maintenance', 'POST', {}), idCtx(car.id))).status).toBe(401);

    await loginAs('viewer');

    expect((await listCarsGet()).status).toBe(200);
    expect((await getCarDetailGet(new Request('http://localhost/api/cars/1'), idCtx(car.id))).status).toBe(200);

    const writeResponses = await Promise.all([
      createCarPost(
        jsonReq('http://localhost/api/cars', 'POST', {
          plate: 'В200ВВ 77',
          brand: 'Hyundai',
          model: 'Solaris',
          status: 'available',
          mileage: 10000,
        }),
      ),
      updateCarPatch(jsonReq('http://localhost/api/cars/1', 'PATCH', { mileage: 60000 }), idCtx(car.id)),
      deleteCarDelete(new Request('http://localhost/api/cars/1', { method: 'DELETE' }), idCtx(car.id)),
      createFinePost(
        jsonReq('http://localhost/api/cars/1/fines', 'POST', {
          resolutionNumber: '18810177261100009999',
          violatedAt: '2026-11-10T12:00:00+03:00',
          amount: 1000,
          paymentDeadline: '2027-01-10',
          description: 'Превышение скорости',
        }),
        idCtx(car.id),
      ),
      syncFinesPost(new Request('http://localhost/api/cars/1/fines/sync', { method: 'POST' }), idCtx(car.id)),
      upsertRentalPut(
        jsonReq('http://localhost/api/cars/1/rental', 'PUT', {
          renterName: 'Петров П.П.',
          rateAmount: 2000,
          periodicity: 'daily',
          startDate: '2026-11-01',
        }),
        idCtx(car.id),
      ),
      togglePaymentPost(
        jsonReq('http://localhost/api/cars/1/rental/payments', 'POST', {
          dueDate: '2026-11-01',
          paid: true,
        }),
        idCtx(car.id),
      ),
      createMaintenancePost(
        jsonReq('http://localhost/api/cars/1/maintenance', 'POST', {
          title: 'ТО-50',
          performedAt: '2026-11-15',
          mileage: 50000,
          laborCost: 2000,
          parts: [],
        }),
        idCtx(car.id),
      ),
    ]);

    for (const res of writeResponses) {
      expect(res.status).toBe(403);
    }
  });

  it('rejects non-positive-integer route IDs and invalid payloads with Russian 400 errors', async () => {
    await loginAs('admin');

    for (const badId of ['0', '-3', 'abc', '1abc', '1.5']) {
      const res = await getCarDetailGet(new Request('http://localhost/api/cars/bad'), idCtx(badId));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
    }

    const badJsonRes = await createCarPost(rawReq('http://localhost/api/cars', 'POST', '{not-json'));
    expect(badJsonRes.status).toBe(400);
    expect(((await badJsonRes.json()) as { error: string }).error).toMatch(/[А-Яа-яЁё]/);

    const invalidPayloads = [
      null,
      {},
      { plate: 123, brand: 'Kia', model: 'Rio', status: 'available', mileage: 10 },
      { plate: 'А123ВС 777', brand: 'Kia', model: 'Rio', status: 'broken', mileage: 10 },
      { plate: 'А123ВС 777', brand: 'Kia', model: 'Rio', status: 'available', mileage: '100' },
      { plate: 'А123ВС 777', brand: 'Kia', model: 'Rio', status: 'available', mileage: -5 },
    ];

    for (const payload of invalidPayloads) {
      const res = await createCarPost(jsonReq('http://localhost/api/cars', 'POST', payload));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    const [car] = await mockState.db!
      .insert(cars)
      .values({ plate: 'Е111КХ 777', brand: 'Kia', model: 'Rio', status: 'available', mileage: 1000 })
      .returning();

    const badPatchPayloads = [
      null,
      {},
      { plate: 123 },
      { brand: 123 },
      { model: 123 },
      { status: 'broken' },
      { mileage: 'abc' },
    ];
    for (const payload of badPatchPayloads) {
      const res = await updateCarPatch(jsonReq('http://localhost/api/cars/1', 'PATCH', payload), idCtx(car.id));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    const badMaintPayloads = [
      null,
      {},
      { title: 123, performedAt: '2026-11-20', mileage: 1000, laborCost: 500 },
      { title: 'ТО', performedAt: 123, mileage: 1000, laborCost: 500 },
      { title: 'ТО', performedAt: '2026-02-31', mileage: 1000, laborCost: 500, parts: [] },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 'abc', laborCost: 500 },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 1000, laborCost: 'abc' },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 1000, laborCost: 500, notes: 123 },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 1000, laborCost: 500, parts: 'bad' },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 1000, laborCost: 500, parts: [null] },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 1000, laborCost: 500, parts: [{ name: 123, unitPrice: 100 }] },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 1000, laborCost: 500, parts: [{ name: 'Фильтр', sku: 123, unitPrice: 100 }] },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 1000, laborCost: 500, parts: [{ name: 'Фильтр', quantity: 'x', unitPrice: 100 }] },
      { title: 'ТО', performedAt: '2026-11-20', mileage: 1000, laborCost: 500, parts: [{ name: 'Фильтр', unitPrice: 'x' }] },
    ];
    for (const payload of badMaintPayloads) {
      const res = await createMaintenancePost(
        jsonReq('http://localhost/api/cars/1/maintenance', 'POST', payload),
        idCtx(car.id),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    const badRentalPayloads = [
      null,
      {},
      { renterName: 123, rateAmount: 2000, periodicity: 'daily', startDate: '2026-11-10' },
      { renterName: 'Иванов', rateAmount: 'abc', periodicity: 'daily', startDate: '2026-11-10' },
      { renterName: 'Иванов', rateAmount: null, periodicity: 'daily', startDate: '2026-11-10' },
      { renterName: 'Иванов', rateAmount: 2000, periodicity: 'yearly', startDate: '2026-11-10' },
      { renterName: 'Иванов', rateAmount: 2000, periodicity: 'daily', startDate: 123 },
      { renterName: 'Иванов', rateAmount: 2000, periodicity: 'daily', startDate: '2026-11-10', active: 'yes' },
    ];
    for (const payload of badRentalPayloads) {
      const res = await upsertRentalPut(
        jsonReq('http://localhost/api/cars/1/rental', 'PUT', payload),
        idCtx(car.id),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    const badFinePayloads = [
      null,
      {},
      { resolutionNumber: 123, violatedAt: '2026-11-10', amount: 500, paymentDeadline: '2026-12-10', description: 'd' },
      { resolutionNumber: '1', violatedAt: 123, amount: 500, paymentDeadline: '2026-12-10', description: 'd' },
      { resolutionNumber: '1', violatedAt: '2026-11-10', amount: '500', paymentDeadline: '2026-12-10', description: 'd' },
      { resolutionNumber: '1', violatedAt: '2026-11-10', amount: 500, discountAmount: '100', paymentDeadline: '2026-12-10', description: 'd' },
      { resolutionNumber: '1', violatedAt: '2026-11-10', amount: 500, discountDeadline: 123, paymentDeadline: '2026-12-10', description: 'd' },
      { resolutionNumber: '1', violatedAt: '2026-11-10', amount: 500, paymentDeadline: 123, description: 'd' },
      { resolutionNumber: '1', violatedAt: '2026-11-10', amount: 500, paymentDeadline: '2026-12-10', description: 123 },
      { resolutionNumber: '1', violatedAt: '2026-11-10', amount: 500, paymentDeadline: '2026-12-10', description: 'd', status: 'pending' },
    ];
    for (const payload of badFinePayloads) {
      const res = await createFinePost(
        jsonReq('http://localhost/api/cars/1/fines', 'POST', payload),
        idCtx(car.id),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    const badPaymentPayloads = [
      null,
      {},
      { dueDate: 123, paid: true },
      { dueDate: '2026-11-01', paid: 'yes' },
      { dueDate: '2026-11-01', paid: true, amount: 'abc' },
    ];
    for (const payload of badPaymentPayloads) {
      const res = await togglePaymentPost(
        jsonReq('http://localhost/api/cars/1/rental/payments', 'POST', payload),
        idCtx(car.id),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    for (const nanCheck of [
      createCarSchema.safeParse({ plate: 'А123ВС 777', brand: 'Kia', model: 'Rio', status: 'available', mileage: Number.NaN }),
      updateCarSchema.safeParse({ mileage: Number.NaN }),
      upsertRentalSchema.safeParse({ renterName: 'Иванов', rateAmount: Number.NaN, periodicity: 'daily', startDate: '2026-11-10' }),
    ]) {
      expect(nanCheck.success).toBe(false);
      if (!nanCheck.success) {
        const msg = nanCheck.error.issues[0]?.message ?? '';
        expect(msg).toMatch(/[А-Яа-яЁё]/);
        expect(msg).not.toMatch(/invalid input|expected/i);
      }
    }
  });

  it('creates, lists, updates, and deletes cars with 404/409 handling and unpaidFinesCount', async () => {
    await loginAs('admin');

    const createRes = await createCarPost(
      jsonReq('http://localhost/api/cars', 'POST', {
        plate: '  А123ВС 777 ',
        brand: 'Kia',
        model: 'Rio',
        status: 'in_rent',
        mileage: 142500,
      }),
    );
    expect(createRes.status).toBe(201);
    const { car: created } = (await createRes.json()) as { car: { id: number; plate: string; unpaidFinesCount: number } };
    expect(created).toMatchObject({
      plate: 'А123ВС 777',
      brand: 'Kia',
      model: 'Rio',
      status: 'in_rent',
      mileage: 142500,
      unpaidFinesCount: 0,
    });

    const dupRes = await createCarPost(
      jsonReq('http://localhost/api/cars', 'POST', {
        plate: 'А123ВС 777',
        brand: 'Hyundai',
        model: 'Solaris',
        status: 'available',
        mileage: 1000,
      }),
    );
    expect(dupRes.status).toBe(409);
    expect(((await dupRes.json()) as { error: string }).error).toBe(
      'Автомобиль с таким гос. номером уже существует',
    );

    const secondRes = await createCarPost(
      jsonReq('http://localhost/api/cars', 'POST', {
        plate: 'В456ОР 777',
        brand: 'Hyundai',
        model: 'Solaris',
        status: 'available',
        mileage: 50000,
      }),
    );
    expect(secondRes.status).toBe(201);
    const { car: second } = (await secondRes.json()) as { car: { id: number } };

    // Add 2 unpaid + 1 paid fines to first car
    await mockState.db!.insert(fines).values([
      {
        carId: created.id,
        resolutionNumber: '18810177261100000011',
        violatedAt: '2026-11-10T10:00:00+03:00',
        amount: 750,
        discountAmount: 562,
        discountDeadline: '2026-12-10',
        paymentDeadline: '2027-01-19',
        description: 'Скорость 1',
        status: 'unpaid',
      },
      {
        carId: created.id,
        resolutionNumber: '18810177261100000012',
        violatedAt: '2026-11-15T12:00:00+03:00',
        amount: 1500,
        discountAmount: null,
        discountDeadline: null,
        paymentDeadline: '2027-01-24',
        description: 'Полоса',
        status: 'unpaid',
      },
      {
        carId: created.id,
        resolutionNumber: '18810177261100000013',
        violatedAt: '2026-11-01T08:00:00+03:00',
        amount: 500,
        discountAmount: 375,
        discountDeadline: '2026-12-01',
        paymentDeadline: '2027-01-10',
        description: 'Ремень',
        status: 'paid',
      },
    ]);

    const listRes = await listCarsGet();
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      cars: Array<{ id: number; unpaidFinesCount: number }>;
    };
    expect(listBody.cars).toHaveLength(2);
    expect(listBody.cars.find((c) => c.id === created.id)?.unpaidFinesCount).toBe(2);
    expect(listBody.cars.find((c) => c.id === second.id)?.unpaidFinesCount).toBe(0);

    // PATCH conflict & success & 404
    const patchConflict = await updateCarPatch(
      jsonReq('http://localhost/api/cars', 'PATCH', { plate: 'В456ОР 777' }),
      idCtx(created.id),
    );
    expect(patchConflict.status).toBe(409);

    const patchOk = await updateCarPatch(
      jsonReq('http://localhost/api/cars', 'PATCH', { status: 'in_repair', mileage: 143000 }),
      idCtx(created.id),
    );
    expect(patchOk.status).toBe(200);
    const patchedBody = (await patchOk.json()) as {
      car: { status: string; mileage: number; unpaidFinesCount: number };
    };
    expect(patchedBody.car).toMatchObject({
      status: 'in_repair',
      mileage: 143000,
      unpaidFinesCount: 2,
    });

    expect((await updateCarPatch(jsonReq('http://localhost/api/cars', 'PATCH', { mileage: 10 }), idCtx(9999))).status).toBe(404);
    expect((await getCarDetailGet(new Request('http://localhost/api/cars/9999'), idCtx(9999))).status).toBe(404);

    // DELETE & 404
    const delRes = await deleteCarDelete(new Request('http://localhost/api/cars', { method: 'DELETE' }), idCtx(second.id));
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ ok: true });
    expect((await getCarDetailGet(new Request('http://localhost/api/cars'), idCtx(second.id))).status).toBe(404);
    expect((await deleteCarDelete(new Request('http://localhost/api/cars', { method: 'DELETE' }), idCtx(second.id))).status).toBe(404);
  });

  it('handles manual fine creation, duplicate 409, syncCarFines, and newest-first sorting in detail view', async () => {
    await loginAs('admin');

    expect(
      (
        await createFinePost(
          jsonReq('http://localhost/api/cars/999/fines', 'POST', {
            resolutionNumber: '18810177261100005001',
            violatedAt: '2026-11-18T14:20',
            amount: 1000,
            paymentDeadline: '2027-01-20',
            description: 'Штраф',
          }),
          idCtx(999),
        )
      ).status,
    ).toBe(404);
    expect((await syncFinesPost(new Request('http://localhost/api/cars/999/fines/sync', { method: 'POST' }), idCtx(999))).status).toBe(404);

    const [car] = await mockState.db!
      .insert(cars)
      .values({ plate: 'М321ТН 777', brand: 'Geely', model: 'Coolray', status: 'available', mileage: 34100 })
      .returning();

    const fineRes = await createFinePost(
      jsonReq('http://localhost/api/cars/1/fines', 'POST', {
        resolutionNumber: '18810177261100005001',
        violatedAt: '2026-11-20T18:30',
        amount: 2500,
        discountAmount: null,
        discountDeadline: '',
        paymentDeadline: '2027-01-29',
        description: 'Проезд на красный',
      }),
      idCtx(car.id),
    );
    expect(fineRes.status).toBe(201);
    const { fine: createdFine } = (await fineRes.json()) as { fine: Record<string, unknown> };
    expect(createdFine).toMatchObject({
      carId: car.id,
      resolutionNumber: '18810177261100005001',
      discountAmount: null,
      discountDeadline: null,
      status: 'unpaid',
    });

    const dupFineRes = await createFinePost(
      jsonReq('http://localhost/api/cars/1/fines', 'POST', {
        resolutionNumber: '18810177261100005001',
        violatedAt: '2026-11-20T18:30',
        amount: 2500,
        paymentDeadline: '2027-01-29',
        description: 'Дубликат',
      }),
      idCtx(car.id),
    );
    expect(dupFineRes.status).toBe(409);
    expect(((await dupFineRes.json()) as { error: string }).error).toBe(
      'Штраф с таким номером постановления уже существует',
    );

    const internalSyntaxRes = handleApiError(new SyntaxError('unexpected internal parse failure'));
    expect(internalSyntaxRes.status).toBe(500);

    const sync1 = await syncFinesPost(new Request('http://localhost/api/cars/1/fines/sync', { method: 'POST' }), idCtx(car.id));
    expect(sync1.status).toBe(200);
    const sync1Body = (await sync1.json()) as { inserted: number; updated: number };
    expect(sync1Body.inserted).toBeGreaterThanOrEqual(1);
    expect(sync1Body.updated).toBe(0);

    const sync2 = await syncFinesPost(new Request('http://localhost/api/cars/1/fines/sync', { method: 'POST' }), idCtx(car.id));
    expect(sync2.status).toBe(200);
    expect(await sync2.json()).toEqual({ inserted: 0, updated: sync1Body.inserted });

    const detailRes = await getCarDetailGet(new Request('http://localhost/api/cars/1'), idCtx(car.id));
    expect(detailRes.status).toBe(200);
    const { car: detail } = (await detailRes.json()) as {
      car: { fines: Array<{ violatedAt: string }> };
    };
    const dates = detail.fines.map((f) => f.violatedAt);
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
  });

  it('upserts rental terms, toggles rental payments, and builds timeline', async () => {
    await loginAs('admin');

    expect(
      (
        await upsertRentalPut(
          jsonReq('http://localhost/api/cars/999/rental', 'PUT', {
            renterName: 'Иванов И.И.',
            rateAmount: 2400,
            periodicity: 'weekly',
            startDate: '2026-11-01',
          }),
          idCtx(999),
        )
      ).status,
    ).toBe(404);

    const [car] = await mockState.db!
      .insert(cars)
      .values({ plate: 'А777АА 777', brand: 'Kia', model: 'K5', status: 'in_rent', mileage: 80000 })
      .returning();

    // Missing rental -> 404 on payment toggle
    expect(
      (
        await togglePaymentPost(
          jsonReq('http://localhost/api/cars/1/rental/payments', 'POST', {
            dueDate: '2026-11-01',
            paid: true,
          }),
          idCtx(car.id),
        )
      ).status,
    ).toBe(404);

    const todayIso = new Date().toISOString().slice(0, 10);
    const startIso = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const rentalRes1 = await upsertRentalPut(
      jsonReq('http://localhost/api/cars/1/rental', 'PUT', {
        renterName: 'Иванов Алексей',
        rateAmount: 2400,
        periodicity: 'weekly',
        startDate: startIso,
      }),
      idCtx(car.id),
    );
    expect(rentalRes1.status).toBe(200);
    const { rental: r1 } = (await rentalRes1.json()) as { rental: { id: number; active: boolean } };
    expect(r1.active).toBe(true);

    // Mark startIso paid (defaults amount to 2400)
    const payTrueRes = await togglePaymentPost(
      jsonReq('http://localhost/api/cars/1/rental/payments', 'POST', {
        dueDate: startIso,
        paid: true,
      }),
      idCtx(car.id),
    );
    expect(payTrueRes.status).toBe(200);
    const { payment: p1 } = (await payTrueRes.json()) as {
      payment: { amount: number; paidAt: string | null };
    };
    expect(p1.amount).toBe(2400);
    expect(p1.paidAt).not.toBeNull();

    // Update rental terms in-place; payment should remain linked to same rental id
    const rentalRes2 = await upsertRentalPut(
      jsonReq('http://localhost/api/cars/1/rental', 'PUT', {
        renterName: 'Иванов Алексей Сергеевич',
        rateAmount: 2600,
        periodicity: 'weekly',
        startDate: startIso,
      }),
      idCtx(car.id),
    );
    expect(rentalRes2.status).toBe(200);
    const { rental: r2 } = (await rentalRes2.json()) as { rental: { id: number; rateAmount: number } };
    expect(r2.id).toBe(r1.id);
    expect(r2.rateAmount).toBe(2600);

    const detail1 = (await (await getCarDetailGet(new Request('http://localhost/api/cars/1'), idCtx(car.id))).json()) as {
      car: { timeline: Array<{ dueDate: string; status: string; amount: number }> };
    };
    expect(detail1.car.timeline).toEqual([
      { dueDate: startIso, status: 'paid', amount: 2400, paidAt: p1.paidAt },
      { dueDate: todayIso, status: 'upcoming', amount: 2600, paidAt: null },
    ]);

    // Toggle payment off -> paidAt becomes null, amount override preserved
    const payFalseRes = await togglePaymentPost(
      jsonReq('http://localhost/api/cars/1/rental/payments', 'POST', {
        dueDate: startIso,
        paid: false,
      }),
      idCtx(car.id),
    );
    expect(payFalseRes.status).toBe(200);
    const { payment: p2 } = (await payFalseRes.json()) as {
      payment: { amount: number; paidAt: string | null };
    };
    expect(p2.amount).toBe(2400);
    expect(p2.paidAt).toBeNull();
  });

  it('adds maintenance records with 0 parts, blank/omitted SKU, exact totalCost, and monotonic car.mileage (Review Focus #5)', async () => {
    await loginAs('admin');

    expect(
      (
        await createMaintenancePost(
          jsonReq('http://localhost/api/cars/999/maintenance', 'POST', {
            title: 'Диагностика',
            performedAt: '2026-11-15',
            mileage: 1000,
            laborCost: 1500,
            parts: [],
          }),
          idCtx(999),
        )
      ).status,
    ).toBe(404);

    const [car] = await mockState.db!
      .insert(cars)
      .values({ plate: 'О555ОО 777', brand: 'Skoda', model: 'Octavia', status: 'in_repair', mileage: 140000 })
      .returning();

    // 1) 0 parts and LOWER mileage -> totalCost === laborCost, car.mileage unchanged (140000)
    const zeroPartsRes = await createMaintenancePost(
      jsonReq('http://localhost/api/cars/1/maintenance', 'POST', {
        title: 'Ретроспективная запись диагностики',
        performedAt: '2026-10-01',
        mileage: 132000,
        laborCost: 1800,
        notes: '   ',
        parts: [],
      }),
      idCtx(car.id),
    );
    expect(zeroPartsRes.status).toBe(201);
    const { record: rec1 } = (await zeroPartsRes.json()) as {
      record: { totalCost: number; mileage: number; notes: string | null; parts: unknown[] };
    };
    expect(rec1).toMatchObject({
      mileage: 132000,
      totalCost: 1800,
      notes: null,
      parts: [],
    });

    let [freshCar] = await mockState.db!.select().from(cars).where(eq(cars.id, car.id));
    expect(freshCar.mileage).toBe(140000);

    // 2) Multiple parts with omitted SKU, whitespace SKU, omitted quantity -> normalizes SKU to null and computes totalCost
    const withPartsRes = await createMaintenancePost(
      jsonReq('http://localhost/api/cars/1/maintenance', 'POST', {
        title: 'ТО-145: тормоза и расходники',
        performedAt: '2026-11-18',
        mileage: 145500,
        laborCost: 4500,
        notes: 'Заменены диски и колодки',
        parts: [
          { name: 'Диск тормозной', sku: '1K0-615-301', quantity: 2, unitPrice: 3900 },
          { name: 'Смазка медная', unitPrice: 400 },
          { name: 'Очиститель тормозов', sku: '   ', quantity: 2, unitPrice: 350 },
        ],
      }),
      idCtx(car.id),
    );
    expect(withPartsRes.status).toBe(201);
    const { record: rec2 } = (await withPartsRes.json()) as {
      record: {
        totalCost: number;
        mileage: number;
        notes: string | null;
        parts: Array<{ name: string; sku: string | null; quantity: number; unitPrice: number }>;
      };
    };
    // 4500 + (2*3900 + 1*400 + 2*350) = 4500 + 7800 + 400 + 700 = 13400
    expect(rec2.totalCost).toBe(13400);
    expect(rec2.notes).toBe('Заменены диски и колодки');
    expect(rec2.parts.map((p) => [p.name, p.sku, p.quantity, p.unitPrice])).toEqual([
      ['Диск тормозной', '1K0-615-301', 2, 3900],
      ['Смазка медная', null, 1, 400],
      ['Очиститель тормозов', null, 2, 350],
    ]);

    [freshCar] = await mockState.db!.select().from(cars).where(eq(cars.id, car.id));
    expect(freshCar.mileage).toBe(145500);

    // Detail endpoint returns maintenance sorted newest performedAt first with nested parts
    const detailRes = await getCarDetailGet(new Request('http://localhost/api/cars/1'), idCtx(car.id));
    expect(detailRes.status).toBe(200);
    const { car: detail } = (await detailRes.json()) as {
      car: { mileage: number; maintenance: Array<{ title: string; performedAt: string; parts: unknown[] }> };
    };
    expect(detail.mileage).toBe(145500);
    expect(detail.maintenance.map((m) => m.performedAt)).toEqual(['2026-11-18', '2026-10-01']);
    expect(detail.maintenance[0].parts).toHaveLength(3);
    expect(detail.maintenance[1].parts).toHaveLength(0);
  });
});
