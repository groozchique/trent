import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { cars, maintenanceRecords, rentalPayments, rentals, users } from '@/db/schema';
import { seedDatabase } from '@/db/seed';
import { SESSION_COOKIE_NAME, createSession } from '@/lib/auth/session';
import { GET as getReportsGet } from '@/app/api/reports/route';

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

async function loginAs(role: 'admin' | 'viewer' | 'owner'): Promise<void> {
  const [user] = await mockState.db!.select().from(users).where(eq(users.role, role)).limit(1);
  const { token } = await createSession(mockState.db!, user.id);
  mockState.cookieJar.set(SESSION_COOKIE_NAME, token);
}

describe('GET /api/reports', () => {
  beforeAll(async () => {
    if (!mockState.db) throw new Error('Test DB not initialized');
    await seedDatabase(mockState.db);
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockState.cookieJar.clear();
    const db = mockState.db!;
    await db.delete(maintenanceRecords);
    await db.delete(rentalPayments);
    await db.delete(rentals);
    await db.delete(cars);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await getReportsGet(new Request('http://localhost/api/reports?type=weekly&date=2026-11-25'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as owner', async () => {
    await loginAs('owner');
    const res = await getReportsGet(new Request('http://localhost/api/reports?type=weekly&date=2026-11-25'));
    expect(res.status).toBe(403);
  });

  it('returns 200 for viewer and admin across weekly, monthly, single carId, and includeMaintenance=true', async () => {
    const db = mockState.db!;
    const [car1] = await db
      .insert(cars)
      .values({ plate: 'А111АА 77', brand: 'Kia', model: 'Rio', status: 'in_rent', mileage: 15000 })
      .returning();
    const [car2] = await db
      .insert(cars)
      .values({ plate: 'В222ВВ 77', brand: 'Hyundai', model: 'Solaris', status: 'available', mileage: 25000 })
      .returning();

    const [rental1] = await db
      .insert(rentals)
      .values({
        carId: car1.id,
        renterName: 'Водитель А',
        rateAmount: 2000,
        periodicity: 'daily',
        startDate: '2026-11-01',
        active: true,
        managerCommissionPercent: 10,
      })
      .returning();

    await db.insert(rentalPayments).values({
      rentalId: rental1.id,
      dueDate: '2026-11-25',
      amount: 14000,
      paidAt: '2026-11-25T10:00:00Z',
    });

    await db.insert(maintenanceRecords).values({
      carId: car1.id,
      title: 'Шиномонтаж',
      performedAt: '2026-11-26',
      mileage: 15100,
      laborCost: 2500,
      totalCost: 2500,
    });

    await loginAs('viewer');
    const weeklyRes = await getReportsGet(
      new Request('http://localhost/api/reports?type=weekly&date=2026-11-25'),
    );
    expect(weeklyRes.status).toBe(200);
    const weeklyBody = await weeklyRes.json();
    expect(weeklyBody.report.type).toBe('weekly');
    expect(weeklyBody.report.periodStart).toBe('2026-11-23');
    expect(weeklyBody.report.periodEnd).toBe('2026-11-29');
    expect(weeklyBody.report.includeMaintenance).toBe(false);
    expect(weeklyBody.report.paidRental).toBe(14000);
    expect(weeklyBody.report.managerIncome).toBe(1400);
    expect(weeklyBody.report.maintenanceCost).toBe(0);
    expect(weeklyBody.report.ownerPayout).toBe(12600);
    expect(weeklyBody.report.cars).toHaveLength(2);

    await loginAs('admin');
    const weeklyMaintRes = await getReportsGet(
      new Request(
        `http://localhost/api/reports?type=weekly&date=2026-11-25&carId=${car1.id}&includeMaintenance=true`,
      ),
    );
    expect(weeklyMaintRes.status).toBe(200);
    const weeklyMaintBody = await weeklyMaintRes.json();
    expect(weeklyMaintBody.report.carId).toBe(car1.id);
    expect(weeklyMaintBody.report.includeMaintenance).toBe(true);
    expect(weeklyMaintBody.report.maintenanceCost).toBe(2500);
    expect(weeklyMaintBody.report.ownerPayout).toBe(10100);
    expect(weeklyMaintBody.report.cars).toHaveLength(1);

    const monthlyRes = await getReportsGet(
      new Request(`http://localhost/api/reports?type=monthly&month=2026-11&carId=${car2.id}`),
    );
    expect(monthlyRes.status).toBe(200);
    const monthlyBody = await monthlyRes.json();
    expect(monthlyBody.report.type).toBe('monthly');
    expect(monthlyBody.report.periodLabel).toBe('Ноябрь 2026');
    expect(monthlyBody.report.includeMaintenance).toBe(true);
    expect(monthlyBody.report.paidRental).toBe(0);
    expect(monthlyBody.report.ownerPayout).toBe(0);
  });

  it('returns 400 on invalid query parameters and 404 on missing carId', async () => {
    await loginAs('admin');

    const badUrls = [
      'http://localhost/api/reports?type=yearly&date=2026-11-25',
      'http://localhost/api/reports?type=weekly&date=2026-02-30',
      'http://localhost/api/reports?type=monthly&month=2026-13',
      'http://localhost/api/reports?type=monthly',
      'http://localhost/api/reports?type=weekly&date=2026-11-25&carId=abc',
      'http://localhost/api/reports?type=weekly&date=2026-11-25&includeMaintenance=maybe',
    ];

    for (const url of badUrls) {
      const res = await getReportsGet(new Request(url));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/[А-Яа-яЁё]/);
    }

    const notFoundRes = await getReportsGet(
      new Request('http://localhost/api/reports?type=weekly&date=2026-11-25&carId=99999'),
    );
    expect(notFoundRes.status).toBe(404);
  });
});
