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
  sessions,
  users,
} from '@/db/schema';
import { seedDatabase } from '@/db/seed';
import { verifyPassword } from '@/lib/auth/password';
import * as sessionModule from '@/lib/auth/session';
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/session';
import { getDriverDetail, listDriverSummaries } from '@/lib/drivers';
import { listUsersSafe } from '@/lib/users';
import { shiftUtcDaysIso } from '@/lib/format';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as endRentalPost } from '@/app/api/cars/[id]/rental/end/route';
import { GET as listDriversGet, POST as createDriverPost } from '@/app/api/drivers/route';
import {
  GET as getDriverDetailGet,
  PATCH as updateDriverPatch,
} from '@/app/api/drivers/[id]/route';
import { GET as listUsersGet, POST as createUserPost } from '@/app/api/users/route';
import {
  DELETE as deleteUserDelete,
  PATCH as updateUserPatch,
} from '@/app/api/users/[id]/route';

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

async function loginAs(role: 'admin' | 'viewer'): Promise<number> {
  const [user] = await mockState.db!.select().from(users).where(eq(users.role, role)).limit(1);
  const { token } = await createSession(mockState.db!, user.id);
  mockState.cookieJar.set(SESSION_COOKIE_NAME, token);
  return user.id;
}

async function loginUserId(userId: number): Promise<string> {
  const { token } = await createSession(mockState.db!, userId);
  mockState.cookieJar.set(SESSION_COOKIE_NAME, token);
  return token;
}

describe('Drivers & Admin Users libraries and API routes', () => {
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
    await db.delete(sessions);
    await db.delete(users);
    await seedDatabase(db);
    await db.delete(carDocuments);
    await db.delete(maintenanceParts);
    await db.delete(maintenanceRecords);
    await db.delete(rentalPayments);
    await db.delete(rentals);
    await db.delete(fines);
    await db.delete(drivers);
    await db.delete(cars);
  });

  it('enforces RBAC (401/403) and Russian 400/404 validation on /api/drivers*', async () => {
    const [driver] = await mockState.db!
      .insert(drivers)
      .values({ fullName: 'Тестов Тест Тестович', phone: '+7 999 000-00-00' })
      .returning();

    // Unauthenticated -> 401
    expect((await listDriversGet()).status).toBe(401);
    expect((await createDriverPost(jsonReq('http://localhost/api/drivers', 'POST', {}))).status).toBe(401);
    expect((await getDriverDetailGet(new Request('http://localhost/api/drivers/1'), idCtx(driver.id))).status).toBe(401);
    expect((await updateDriverPatch(jsonReq('http://localhost/api/drivers/1', 'PATCH', {}), idCtx(driver.id))).status).toBe(401);

    // Viewer -> GET allowed (200), POST/PATCH forbidden (403)
    await loginAs('viewer');
    expect((await listDriversGet()).status).toBe(200);
    expect((await getDriverDetailGet(new Request('http://localhost/api/drivers/1'), idCtx(driver.id))).status).toBe(200);
    expect(
      (
        await createDriverPost(
          jsonReq('http://localhost/api/drivers', 'POST', { fullName: 'Новый Водитель' }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await updateDriverPatch(
          jsonReq('http://localhost/api/drivers/1', 'PATCH', { phone: '+7 999 111-11-11' }),
          idCtx(driver.id),
        )
      ).status,
    ).toBe(403);

    // Admin validation -> Russian 400 and 404
    await loginAs('admin');
    for (const badId of ['0', '-2', 'abc', '1.5', '1abc']) {
      const getBad = await getDriverDetailGet(new Request('http://localhost/api/drivers/bad'), idCtx(badId));
      expect(getBad.status).toBe(400);
      expect(((await getBad.json()) as { error: string }).error).toMatch(/[А-Яа-яЁё]/);

      const patchBad = await updateDriverPatch(
        jsonReq('http://localhost/api/drivers/bad', 'PATCH', { notes: 'x' }),
        idCtx(badId),
      );
      expect(patchBad.status).toBe(400);
      expect(((await patchBad.json()) as { error: string }).error).toMatch(/[А-Яа-яЁё]/);
    }

    const malformedJson = await createDriverPost(rawReq('http://localhost/api/drivers', 'POST', '{bad'));
    expect(malformedJson.status).toBe(400);
    expect(((await malformedJson.json()) as { error: string }).error).toMatch(/[А-Яа-яЁё]/);

    for (const payload of [null, {}, { fullName: '   ' }, { fullName: 123 }, { fullName: 'Ок', phone: 123 }]) {
      const res = await createDriverPost(jsonReq('http://localhost/api/drivers', 'POST', payload));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    for (const payload of [null, {}, { fullName: '   ' }, { archived: 'yes' }, { notes: 123 }]) {
      const res = await updateDriverPatch(jsonReq('http://localhost/api/drivers/1', 'PATCH', payload), idCtx(driver.id));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    expect((await getDriverDetailGet(new Request('http://localhost/api/drivers/9999'), idCtx(9999))).status).toBe(404);
    expect(
      (
        await updateDriverPatch(
          jsonReq('http://localhost/api/drivers/9999', 'PATCH', { notes: 'x' }),
          idCtx(9999),
        )
      ).status,
    ).toBe(404);
    expect(await getDriverDetail(mockState.db!, 9999)).toBeNull();
  });

  it('creates/updates drivers, aggregates debt & fines across multiple cars, and enforces archive 409 guard (Review Focus #4)', async () => {
    await loginAs('admin');
    const db = mockState.db!;

    // Create drivers via POST /api/drivers
    const createRes1 = await createDriverPost(
      jsonReq('http://localhost/api/drivers', 'POST', {
        fullName: '  Иванов Алексей  ',
        phone: '  +7 916 111-11-11 ',
        notes: '   ',
      }),
    );
    expect(createRes1.status).toBe(201);
    const { driver: driver1 } = (await createRes1.json()) as {
      driver: {
        id: number;
        fullName: string;
        phone: string | null;
        notes: string | null;
        archived: boolean;
        activeCars: unknown[];
        rentDebt30d: number;
        unpaidFinesSum: number;
        unpaidFinesCount: number;
      };
    };
    expect(driver1).toMatchObject({
      fullName: 'Иванов Алексей',
      phone: '+7 916 111-11-11',
      notes: null,
      archived: false,
      activeCars: [],
      rentDebt30d: 0,
      unpaidFinesSum: 0,
      unpaidFinesCount: 0,
    });

    const createRes2 = await createDriverPost(
      jsonReq('http://localhost/api/drivers', 'POST', {
        fullName: 'Петров Олег',
      }),
    );
    expect(createRes2.status).toBe(201);
    const { driver: driver2 } = (await createRes2.json()) as { driver: { id: number } };

    // Edit phone & notes
    const editRes = await updateDriverPatch(
      jsonReq('http://localhost/api/drivers', 'PATCH', {
        phone: '+7 916 222-22-22',
        notes: 'Ночной график',
      }),
      idCtx(driver1.id),
    );
    expect(editRes.status).toBe(200);
    expect(((await editRes.json()) as { driver: { fullName: string; phone: string; notes: string } }).driver).toMatchObject({
      fullName: 'Иванов Алексей',
      phone: '+7 916 222-22-22',
      notes: 'Ночной график',
    });

    const [car1, car2, car3] = await db
      .insert(cars)
      .values([
        { plate: 'А101АА 777', brand: 'Kia', model: 'Rio', status: 'in_rent', mileage: 10000 },
        { plate: 'В202ВВ 777', brand: 'Hyundai', model: 'Solaris', status: 'in_rent', mileage: 20000 },
        { plate: 'Е303ЕЕ 777', brand: 'Skoda', model: 'Octavia', status: 'available', mileage: 30000 },
      ])
      .returning();

    const todayIso = new Date().toISOString().slice(0, 10);
    const dMinus10 = shiftUtcDaysIso(todayIso, -10);
    const dMinus8 = shiftUtcDaysIso(todayIso, -8);
    const dMinus3 = shiftUtcDaysIso(todayIso, -3);
    const dMinus2 = shiftUtcDaysIso(todayIso, -2);
    const dMinus1 = shiftUtcDaysIso(todayIso, -1);

    // Driver 1 has:
    // - Active daily rental on car1 starting dMinus3 (rate 2000): dMinus3 paid, dMinus2 & dMinus1 overdue (= 4000)
    // - Active weekly rental on car2 starting dMinus8 (rate 3000): dMinus8 overdue, dMinus1 overdue (= 6000)
    // - Closed weekly rental on car3 [dMinus10..dMinus8] (rate 2500): dMinus10 overdue (= 2500)
    // Total rentDebt30d = 4000 + 6000 + 2500 = 12500
    const [r1, r2, r3] = await db
      .insert(rentals)
      .values([
        {
          carId: car1.id,
          driverId: driver1.id,
          renterName: 'Иванов Алексей',
          rateAmount: 2000,
          periodicity: 'daily',
          startDate: dMinus3,
          endDate: null,
          active: true,
        },
        {
          carId: car2.id,
          driverId: driver1.id,
          renterName: 'Иванов Алексей',
          rateAmount: 3000,
          periodicity: 'weekly',
          startDate: dMinus8,
          endDate: null,
          active: true,
        },
        {
          carId: car3.id,
          driverId: driver1.id,
          renterName: 'Иванов Алексей',
          rateAmount: 2500,
          periodicity: 'weekly',
          startDate: dMinus10,
          endDate: dMinus8,
          active: false,
        },
        // Unrelated closed rental for driver2 on car3 (must not leak to driver1)
        {
          carId: car3.id,
          driverId: driver2.id,
          renterName: 'Петров Олег',
          rateAmount: 5000,
          periodicity: 'daily',
          startDate: dMinus1,
          endDate: dMinus1,
          active: false,
        },
      ])
      .returning();

    await db.insert(rentalPayments).values({
      rentalId: r1.id,
      dueDate: dMinus3,
      amount: 2000,
      paidAt: `${dMinus3}T10:00:00Z`,
    });

    await db.insert(fines).values([
      {
        carId: car1.id,
        driverId: driver1.id,
        resolutionNumber: '18810177261100004401',
        violatedAt: `${dMinus2}T10:00:00+03:00`,
        amount: 1500,
        paymentDeadline: '2027-01-20',
        description: 'Скорость 1',
        status: 'unpaid',
      },
      {
        carId: car3.id,
        driverId: driver1.id,
        resolutionNumber: '18810177261100004402',
        violatedAt: `${dMinus8}T12:00:00+03:00`,
        amount: 2500,
        paymentDeadline: '2027-01-25',
        description: 'Полоса',
        status: 'unpaid',
      },
      {
        carId: car2.id,
        driverId: driver1.id,
        resolutionNumber: '18810177261100004403',
        violatedAt: `${dMinus1}T09:00:00+03:00`,
        amount: 500,
        paymentDeadline: '2027-01-25',
        description: 'Ремень (оплачен)',
        status: 'paid',
      },
      // Fine for driver2 -> must not leak
      {
        carId: car3.id,
        driverId: driver2.id,
        resolutionNumber: '18810177261100004404',
        violatedAt: `${dMinus1}T11:00:00+03:00`,
        amount: 9000,
        paymentDeadline: '2027-01-25',
        description: 'Штраф Петрова',
        status: 'unpaid',
      },
    ]);

    // Check listDriverSummaries & GET /api/drivers
    const summariesDirect = await listDriverSummaries(db, todayIso);
    expect(summariesDirect).toHaveLength(2);
    const listRes = await listDriversGet();
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      drivers: Array<{
        id: number;
        activeCars: Array<{ carId: number; plate: string; rentalId: number }>;
        rentDebt30d: number;
        unpaidFinesSum: number;
        unpaidFinesCount: number;
      }>;
    };
    const d1Summary = listBody.drivers.find((d) => d.id === driver1.id)!;
    expect(d1Summary.rentDebt30d).toBe(12500);
    expect(d1Summary.unpaidFinesSum).toBe(4000);
    expect(d1Summary.unpaidFinesCount).toBe(2);
    expect(d1Summary.activeCars).toHaveLength(2);
    expect(d1Summary.activeCars.map((c) => c.carId).sort((a, b) => a - b)).toEqual([car1.id, car2.id]);

    const d2Summary = listBody.drivers.find((d) => d.id === driver2.id)!;
    expect(d2Summary.rentDebt30d).toBe(5000);
    expect(d2Summary.unpaidFinesSum).toBe(9000);
    expect(d2Summary.unpaidFinesCount).toBe(1);
    expect(d2Summary.activeCars).toEqual([]);

    // Check getDriverDetail & GET /api/drivers/[id]
    const detailDirect = await getDriverDetail(db, driver1.id, todayIso);
    expect(detailDirect).not.toBeNull();
    const detailRes = await getDriverDetailGet(new Request('http://localhost/api/drivers/1'), idCtx(driver1.id));
    expect(detailRes.status).toBe(200);
    const { driver: detail } = (await detailRes.json()) as {
      driver: {
        rentDebt30d: number;
        unpaidFinesSum: number;
        unpaidFinesCount: number;
        activeCars: Array<{ carId: number; plate: string }>;
        rentalsHistory: Array<{
          id: number;
          carPlate: string;
          carBrand: string;
          carModel: string;
          rentDebt30d: number;
          active: boolean;
        }>;
        fines: Array<{ id: number; carPlate: string; driverName: string | null; status: string }>;
      };
    };
    expect(detail.rentDebt30d).toBe(12500);
    expect(detail.unpaidFinesSum).toBe(4000);
    expect(detail.unpaidFinesCount).toBe(2);
    expect(detail.activeCars).toHaveLength(2);
    expect(detail.rentalsHistory.map((r) => r.id)).toEqual([r1.id, r2.id, r3.id]);
    expect(detail.rentalsHistory.find((r) => r.id === r3.id)).toMatchObject({
      carPlate: 'Е303ЕЕ 777',
      carBrand: 'Skoda',
      carModel: 'Octavia',
      rentDebt30d: 2500,
      active: false,
    });
    expect(detail.fines).toHaveLength(3);
    expect(detail.fines.map((f) => f.carPlate)).toEqual(['В202ВВ 777', 'А101АА 777', 'Е303ЕЕ 777']);
    expect(detail.fines.every((f) => f.driverName === 'Иванов Алексей')).toBe(true);

    // Archive blocked with 409 while active rental exists (and rolls back any side updates in same PATCH)
    const archiveBlockedRes = await updateDriverPatch(
      jsonReq('http://localhost/api/drivers', 'PATCH', {
        notes: 'Не должно сохраниться',
        archived: true,
      }),
      idCtx(driver1.id),
    );
    expect(archiveBlockedRes.status).toBe(409);
    expect(((await archiveBlockedRes.json()) as { error: string }).error).toBe(
      'Нельзя архивировать водителя с активной арендой',
    );
    const [freshBeforeEnd] = await db.select().from(drivers).where(eq(drivers.id, driver1.id));
    expect(freshBeforeEnd.archived).toBe(false);
    expect(freshBeforeEnd.notes).toBe('Ночной график');

    // Ending only one of two active rentals still blocks archiving (409)
    expect((await endRentalPost(jsonReq('http://localhost/x', 'POST', {}), idCtx(car1.id))).status).toBe(200);
    expect(
      (
        await updateDriverPatch(
          jsonReq('http://localhost/api/drivers', 'PATCH', { archived: true }),
          idCtx(driver1.id),
        )
      ).status,
    ).toBe(409);

    // Ending second active rental allows archiving -> 200
    expect((await endRentalPost(jsonReq('http://localhost/x', 'POST', {}), idCtx(car2.id))).status).toBe(200);
    const archiveOkRes = await updateDriverPatch(
      jsonReq('http://localhost/api/drivers', 'PATCH', { archived: true, notes: '   ' }),
      idCtx(driver1.id),
    );
    expect(archiveOkRes.status).toBe(200);
    const archivedBody = (await archiveOkRes.json()) as {
      driver: { archived: boolean; notes: string | null; activeCars: unknown[] };
    };
    expect(archivedBody.driver.archived).toBe(true);
    expect(archivedBody.driver.notes).toBeNull();
    expect(archivedBody.driver.activeCars).toEqual([]);

    // Unarchiving works cleanly
    const unarchiveRes = await updateDriverPatch(
      jsonReq('http://localhost/api/drivers', 'PATCH', { archived: false }),
      idCtx(driver1.id),
    );
    expect(unarchiveRes.status).toBe(200);
    expect(((await unarchiveRes.json()) as { driver: { archived: boolean } }).driver.archived).toBe(false);
  });

  it('enforces admin-only RBAC (401/403) and Russian 400/404 validation on /api/users*', async () => {
    const [viewer] = await mockState.db!.select().from(users).where(eq(users.role, 'viewer')).limit(1);

    // Unauthenticated -> 401
    expect((await listUsersGet()).status).toBe(401);
    expect((await createUserPost(jsonReq('http://localhost/api/users', 'POST', {}))).status).toBe(401);
    expect((await updateUserPatch(jsonReq('http://localhost/api/users/1', 'PATCH', {}), idCtx(viewer.id))).status).toBe(401);
    expect(
      (await deleteUserDelete(new Request('http://localhost/api/users/1', { method: 'DELETE' }), idCtx(viewer.id))).status,
    ).toBe(401);

    // Viewer -> 403 on all /api/users* endpoints
    await loginAs('viewer');
    expect((await listUsersGet()).status).toBe(403);
    expect(
      (
        await createUserPost(
          jsonReq('http://localhost/api/users', 'POST', {
            username: 'newuser',
            password: 'password123',
            role: 'viewer',
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await updateUserPatch(
          jsonReq('http://localhost/api/users/1', 'PATCH', { role: 'admin' }),
          idCtx(viewer.id),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await deleteUserDelete(
          new Request('http://localhost/api/users/1', { method: 'DELETE' }),
          idCtx(viewer.id),
        )
      ).status,
    ).toBe(403);

    // Admin invalid params & payloads -> Russian 400 / 404
    await loginAs('admin');
    for (const badId of ['0', '-1', 'abc', '1.5']) {
      const pRes = await updateUserPatch(
        jsonReq('http://localhost/api/users/bad', 'PATCH', { role: 'viewer' }),
        idCtx(badId),
      );
      expect(pRes.status).toBe(400);
      expect(((await pRes.json()) as { error: string }).error).toMatch(/[А-Яа-яЁё]/);

      const dRes = await deleteUserDelete(
        new Request('http://localhost/api/users/bad', { method: 'DELETE' }),
        idCtx(badId),
      );
      expect(dRes.status).toBe(400);
      expect(((await dRes.json()) as { error: string }).error).toMatch(/[А-Яа-яЁё]/);
    }

    expect((await createUserPost(rawReq('http://localhost/api/users', 'POST', '{bad'))).status).toBe(400);

    for (const payload of [
      null,
      {},
      { username: 'ab', password: 'password123', role: 'viewer' },
      { username: 'has space', password: 'password123', role: 'viewer' },
      { username: 'validuser', password: '123', role: 'viewer' },
      { username: 'validuser', password: 'password123', role: 'superadmin' },
    ]) {
      const res = await createUserPost(jsonReq('http://localhost/api/users', 'POST', payload));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    for (const payload of [null, {}, { password: '123' }, { role: 'owner' }]) {
      const res = await updateUserPatch(jsonReq('http://localhost/api/users/1', 'PATCH', payload), idCtx(viewer.id));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    expect(
      (
        await updateUserPatch(
          jsonReq('http://localhost/api/users/9999', 'PATCH', { role: 'viewer' }),
          idCtx(9999),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await deleteUserDelete(
          new Request('http://localhost/api/users/9999', { method: 'DELETE' }),
          idCtx(9999),
        )
      ).status,
    ).toBe(404);
  });

  it('creates users with scrypt hash & 409 conflict, blocks self/sole-admin mutations, and revokes sessions (Review Focus #5)', async () => {
    const db = mockState.db!;
    const adminId = await loginAs('admin');

    // listUsersSafe and GET /api/users omit passwordHash
    const safeDirect = await listUsersSafe(db);
    expect(safeDirect).toHaveLength(2);
    for (const u of safeDirect) {
      expect('passwordHash' in u).toBe(false);
    }

    const listRes1 = await listUsersGet();
    expect(listRes1.status).toBe(200);
    const listBody1 = (await listRes1.json()) as { users: Array<Record<string, unknown>> };
    expect(listBody1.users).toHaveLength(2);
    for (const u of listBody1.users) {
      expect('passwordHash' in u).toBe(false);
    }

    // Create second admin user -> password hashed with scrypt, passwordHash never returned
    const createAdmin2Res = await createUserPost(
      jsonReq('http://localhost/api/users', 'POST', {
        username: '  manager_admin ',
        password: 'secret-password-1',
        role: 'admin',
      }),
    );
    expect(createAdmin2Res.status).toBe(201);
    const { user: admin2 } = (await createAdmin2Res.json()) as {
      user: { id: number; username: string; role: string; createdAt: string };
    };
    expect(admin2).toMatchObject({ username: 'manager_admin', role: 'admin' });
    expect('passwordHash' in admin2).toBe(false);

    const [admin2DbRow] = await db.select().from(users).where(eq(users.id, admin2.id));
    expect(admin2DbRow.passwordHash).not.toBe('secret-password-1');
    expect(admin2DbRow.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(verifyPassword('secret-password-1', admin2DbRow.passwordHash)).toBe(true);

    // Duplicate username -> 409
    const dupUserRes = await createUserPost(
      jsonReq('http://localhost/api/users', 'POST', {
        username: 'manager_admin',
        password: 'another-password',
        role: 'viewer',
      }),
    );
    expect(dupUserRes.status).toBe(409);
    expect(((await dupUserRes.json()) as { error: string }).error).toBe(
      'Пользователь с таким логином уже существует',
    );

    // Self-deletion -> 400
    const selfDeleteRes = await deleteUserDelete(
      new Request('http://localhost/api/users', { method: 'DELETE' }),
      idCtx(adminId),
    );
    expect(selfDeleteRes.status).toBe(400);
    expect(((await selfDeleteRes.json()) as { error: string }).error).toBe(
      'Нельзя удалить текущего пользователя',
    );

    // admin2 logs in and can access GET /api/users
    const admin2Token = await loginUserId(admin2.id);
    expect((await listUsersGet()).status).toBe(200);
    expect(await db.select().from(sessions).where(eq(sessions.userId, admin2.id))).toHaveLength(1);

    // admin1 demotes admin2 -> viewer: deletes admin2's sessions immediately!
    const admin1Token = await loginUserId(adminId);
    const demoteAdmin2Res = await updateUserPatch(
      jsonReq('http://localhost/api/users', 'PATCH', { role: 'viewer' }),
      idCtx(admin2.id),
    );
    expect(demoteAdmin2Res.status).toBe(200);
    expect(((await demoteAdmin2Res.json()) as { user: { role: string } }).user.role).toBe('viewer');
    expect(await db.select().from(sessions).where(eq(sessions.userId, admin2.id))).toHaveLength(0);

    // Subsequent request with admin2's old session cookie -> 401
    mockState.cookieJar.set(SESSION_COOKIE_NAME, admin2Token);
    expect((await listUsersGet()).status).toBe(401);

    // Re-login as admin2 -> succeeds, now has role 'viewer' so /api/users returns 403
    const reLoginRes = await loginPost(
      jsonReq('http://localhost/api/auth/login', 'POST', {
        username: 'manager_admin',
        password: 'secret-password-1',
      }),
    );
    expect(reLoginRes.status).toBe(200);
    const reLoginBody = (await reLoginRes.json()) as { user: { role: string } };
    expect(reLoginBody.user.role).toBe('viewer');
    await loginUserId(admin2.id);
    expect((await listUsersGet()).status).toBe(403);

    // admin1 resets admin2's password -> deletes admin2's active sessions immediately!
    mockState.cookieJar.set(SESSION_COOKIE_NAME, admin1Token);
    const admin2SessionsBeforeReset = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, admin2.id));
    expect(admin2SessionsBeforeReset.length).toBeGreaterThanOrEqual(1);

    const resetPwRes = await updateUserPatch(
      jsonReq('http://localhost/api/users', 'PATCH', { password: 'updated-password-2' }),
      idCtx(admin2.id),
    );
    expect(resetPwRes.status).toBe(200);
    expect('passwordHash' in ((await resetPwRes.json()) as { user: Record<string, unknown> }).user).toBe(false);
    expect(await db.select().from(sessions).where(eq(sessions.userId, admin2.id))).toHaveLength(0);

    // Old password rejected, new password works
    expect(
      (
        await loginPost(
          jsonReq('http://localhost/api/auth/login', 'POST', {
            username: 'manager_admin',
            password: 'secret-password-1',
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await loginPost(
          jsonReq('http://localhost/api/auth/login', 'POST', {
            username: 'manager_admin',
            password: 'updated-password-2',
          }),
        )
      ).status,
    ).toBe(200);

    // Now admin1 is the sole admin in DB:
    // 1) Demoting sole admin -> 400
    mockState.cookieJar.set(SESSION_COOKIE_NAME, admin1Token);
    const soleDemoteRes = await updateUserPatch(
      jsonReq('http://localhost/api/users', 'PATCH', { role: 'viewer' }),
      idCtx(adminId),
    );
    expect(soleDemoteRes.status).toBe(400);
    expect(((await soleDemoteRes.json()) as { error: string }).error).toBe(
      'Нельзя снять права у последнего администратора',
    );
    expect((await db.select().from(users).where(eq(users.id, adminId)))[0].role).toBe('admin');

    // 2) Deleting sole admin (when caller is another admin context) -> 400
    vi.spyOn(sessionModule, 'requireAdmin').mockResolvedValueOnce({
      id: 999999,
      username: 'other_admin',
      role: 'admin',
    });
    const soleDeleteRes = await deleteUserDelete(
      new Request('http://localhost/api/users', { method: 'DELETE' }),
      idCtx(adminId),
    );
    expect(soleDeleteRes.status).toBe(400);
    expect(((await soleDeleteRes.json()) as { error: string }).error).toBe(
      'Нельзя удалить последнего администратора',
    );

    // Deleting non-sole user succeeds and cascade-deletes all active sessions
    const freshAdmin2Token = await loginUserId(admin2.id);
    expect(await db.select().from(sessions).where(eq(sessions.userId, admin2.id))).toHaveLength(2);
    mockState.cookieJar.set(SESSION_COOKIE_NAME, admin1Token);
    const delUser2Res = await deleteUserDelete(
      new Request('http://localhost/api/users', { method: 'DELETE' }),
      idCtx(admin2.id),
    );
    expect(delUser2Res.status).toBe(200);
    expect(await delUser2Res.json()).toEqual({ ok: true });
    expect(await db.select().from(sessions).where(eq(sessions.userId, admin2.id))).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.id, admin2.id))).toHaveLength(0);

    mockState.cookieJar.set(SESSION_COOKIE_NAME, freshAdmin2Token);
    expect((await listDriversGet()).status).toBe(401);

    // No-op role PATCH on admin preserves current admin's active session
    mockState.cookieJar.set(SESSION_COOKIE_NAME, admin1Token);
    const noopRoleRes = await updateUserPatch(
      jsonReq('http://localhost/api/users', 'PATCH', { role: 'admin' }),
      idCtx(adminId),
    );
    expect(noopRoleRes.status).toBe(200);
    expect((await listUsersGet()).status).toBe(200);
  });
});
