import { scryptSync, timingSafeEqual } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '@/db';
import {
  cars,
  fines,
  maintenanceParts,
  maintenanceRecords,
  rentalPayments,
  rentals,
  users,
} from '@/db/schema';
import { seedDatabase } from '@/db/seed';

function verifyScrypt(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plain, saltHex, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

describe('database schema and seed', () => {
  it('seeds admin, viewer, and sample cars idempotently', async () => {
    const db = createDb(':memory:');
    await seedDatabase(db);
    await seedDatabase(db);

    const allUsers = await db.select().from(users);
    const allCars = await db.select().from(cars);
    const allFines = await db.select().from(fines);
    const allRentals = await db.select().from(rentals);
    const allPayments = await db.select().from(rentalPayments);
    const allMaint = await db.select().from(maintenanceRecords);
    const allParts = await db.select().from(maintenanceParts);

    expect(allUsers.map((u) => u.username).sort()).toEqual(['admin', 'viewer']);
    const admin = allUsers.find((u) => u.username === 'admin');
    const viewer = allUsers.find((u) => u.username === 'viewer');
    expect(admin?.role).toBe('admin');
    expect(viewer?.role).toBe('viewer');
    expect(verifyScrypt('admin123', admin?.passwordHash ?? '')).toBe(true);
    expect(verifyScrypt('viewer123', viewer?.passwordHash ?? '')).toBe(true);

    expect(allCars.length).toBeGreaterThanOrEqual(4);
    expect(new Set(allCars.map((c) => c.status))).toEqual(
      new Set(['in_rent', 'in_repair', 'available']),
    );
    expect(allFines.length).toBeGreaterThanOrEqual(4);
    expect(allRentals.length).toBeGreaterThan(0);
    expect(allPayments.length).toBeGreaterThan(0);
    expect(allMaint.length).toBeGreaterThan(0);
    expect(allParts.length).toBeGreaterThan(0);
  });

  it('enforces foreign_keys cascade deletes', async () => {
    const db = createDb(':memory:');
    await seedDatabase(db);

    const [firstCar] = await db.select().from(cars).limit(1);
    await db.delete(cars).where(eq(cars.id, firstCar.id));

    const remainingFines = await db.select().from(fines).where(eq(fines.carId, firstCar.id));
    const remainingRentals = await db.select().from(rentals).where(eq(rentals.carId, firstCar.id));
    const remainingMaint = await db
      .select()
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.carId, firstCar.id));

    expect(remainingFines).toHaveLength(0);
    expect(remainingRentals).toHaveLength(0);
    expect(remainingMaint).toHaveLength(0);
  });
});
