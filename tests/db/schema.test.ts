import { scryptSync, timingSafeEqual } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '@/db';
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

function verifyScrypt(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plain, saltHex, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function daysBetweenIso(targetIso: string, todayIso: string): number {
  const targetMs = Date.parse(`${targetIso.slice(0, 10)}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((targetMs - todayMs) / 86_400_000);
}

describe('database schema and seed', () => {
  it('seeds admin, viewer, drivers, cars with STS, documents, historical rental, and attributed fines idempotently', async () => {
    const db = createDb(':memory:');
    await seedDatabase(db);
    await seedDatabase(db);

    const allUsers = await db.select().from(users);
    const allCars = await db.select().from(cars);
    const allDrivers = await db.select().from(drivers);
    const allDocs = await db.select().from(carDocuments);
    const allFines = await db.select().from(fines);
    const allRentals = await db.select().from(rentals);
    const allPayments = await db.select().from(rentalPayments);
    const allMaint = await db.select().from(maintenanceRecords);
    const allParts = await db.select().from(maintenanceParts);

    expect(allUsers.map((u) => u.username).sort()).toEqual(['admin', 'owner', 'viewer']);
    const admin = allUsers.find((u) => u.username === 'admin');
    const viewer = allUsers.find((u) => u.username === 'viewer');
    const owner = allUsers.find((u) => u.username === 'owner');
    expect(admin?.role).toBe('admin');
    expect(viewer?.role).toBe('viewer');
    expect(owner?.role).toBe('owner');
    expect(owner?.displayName).toBe('Сергей Волков');
    expect(verifyScrypt('admin123', admin?.passwordHash ?? '')).toBe(true);
    expect(verifyScrypt('viewer123', viewer?.passwordHash ?? '')).toBe(true);
    expect(verifyScrypt('owner123', owner?.passwordHash ?? '')).toBe(true);

    expect(allCars.length).toBeGreaterThanOrEqual(4);
    expect(new Set(allCars.map((c) => c.status))).toEqual(
      new Set(['in_rent', 'in_repair', 'available']),
    );

    const kia = allCars.find((c) => c.plate === 'А123ВС 777');
    const hyundai = allCars.find((c) => c.plate === 'В456ОР 777');
    const skoda = allCars.find((c) => c.plate === 'Е789КХ 799');
    const geely = allCars.find((c) => c.plate === 'М321ТН 777');
    expect(kia?.stsNumber).toBe('99 01 112233');
    expect(hyundai?.stsNumber).toBe('77 44 556677');
    expect(skoda?.stsNumber).toBe('99 02 889900');
    expect(geely?.stsNumber).toBeNull();
    expect(kia?.ownerId).toBe(owner?.id);
    expect(hyundai?.ownerId).toBe(owner?.id);
    expect(skoda?.ownerId).toBeNull();
    expect(geely?.ownerId).toBeNull();
    expect(allCars.some((c) => c.nextServiceMileage !== null && c.nextServiceDate !== null)).toBe(true);

    expect(allDrivers).toHaveLength(3);
    expect(allRentals.length).toBeGreaterThanOrEqual(3);
    const historicalSkodaRental = allRentals.find((r) => r.carId === skoda?.id && !r.active);
    expect(historicalSkodaRental).toBeDefined();
    expect(historicalSkodaRental?.endDate).not.toBeNull();
    expect(historicalSkodaRental?.driverId).not.toBeNull();

    const todayIso = new Date().toISOString().slice(0, 10);
    const docDiffs = allDocs.map((d) => daysBetweenIso(d.expiresAt, todayIso));
    expect(docDiffs.some((d) => d < 0)).toBe(true); // expired
    expect(docDiffs.some((d) => d >= 0 && d <= 14)).toBe(true); // warning
    expect(docDiffs.some((d) => d > 14)).toBe(true); // ok

    expect(allFines.length).toBeGreaterThanOrEqual(6);
    const madiFine = allFines.find((f) => f.resolutionNumber === '18810177261100003001');
    expect(madiFine).toBeDefined();
    expect(madiFine?.discountAmount).toBeNull();
    expect(madiFine?.discountDeadline).toBeNull();
    expect(madiFine?.driverId).toBe(historicalSkodaRental?.driverId);
    expect(allFines.some((f) => f.carId === kia?.id && f.driverId !== null)).toBe(true);

    expect(allPayments.length).toBeGreaterThan(0);
    expect(allMaint.length).toBeGreaterThan(0);
    expect(allParts.length).toBeGreaterThan(0);
  });

  it('enforces foreign_keys cascade deletes and set-null on driver deletion', async () => {
    const db = createDb(':memory:');
    await seedDatabase(db);

    const [firstCar] = await db.select().from(cars).limit(1);
    await db.delete(cars).where(eq(cars.id, firstCar.id));

    const remainingFines = await db.select().from(fines).where(eq(fines.carId, firstCar.id));
    const remainingRentals = await db.select().from(rentals).where(eq(rentals.carId, firstCar.id));
    const remainingDocs = await db
      .select()
      .from(carDocuments)
      .where(eq(carDocuments.carId, firstCar.id));
    const remainingMaint = await db
      .select()
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.carId, firstCar.id));

    expect(remainingFines).toHaveLength(0);
    expect(remainingRentals).toHaveLength(0);
    expect(remainingDocs).toHaveLength(0);
    expect(remainingMaint).toHaveLength(0);

    // Deleting a driver sets driverId to null without deleting rentals/fines
    const [remainingRental] = await db.select().from(rentals).limit(1);
    expect(remainingRental?.driverId).not.toBeNull();
    await db.delete(drivers).where(eq(drivers.id, remainingRental!.driverId!));

    const [afterRental] = await db
      .select()
      .from(rentals)
      .where(eq(rentals.id, remainingRental!.id));
    expect(afterRental?.driverId).toBeNull();

    // Deleting an owner sets cars.ownerId to null without deleting cars
    const [ownerUser] = await db.select().from(users).where(eq(users.username, 'owner'));
    expect(ownerUser).toBeDefined();
    const [ownedCar] = await db.select().from(cars).where(eq(cars.ownerId, ownerUser!.id)).limit(1);
    expect(ownedCar).toBeDefined();
    await db.delete(users).where(eq(users.id, ownerUser!.id));
    const [carAfterOwnerDelete] = await db
      .select()
      .from(cars)
      .where(eq(cars.id, ownedCar!.id));
    expect(carAfterOwnerDelete?.ownerId).toBeNull();
  });
});
