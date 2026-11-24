import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, migrateDbV4 } from '@/db';
import { cars, rentalPayments, rentals, users } from '@/db/schema';

const V3_DDL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX users_username_unique ON users (username);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  plate TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  mileage INTEGER NOT NULL DEFAULT 0,
  sts_number TEXT,
  next_service_mileage INTEGER,
  next_service_date TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX cars_plate_unique ON cars (plate);
CREATE TABLE car_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  policy_number TEXT,
  notes TEXT
);
CREATE UNIQUE INDEX car_documents_car_type_idx ON car_documents (car_id, type);
CREATE TABLE rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  renter_name TEXT NOT NULL,
  rate_amount INTEGER NOT NULL,
  periodicity TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  manager_commission_percent REAL NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX rentals_active_car_unique ON rentals (car_id) WHERE active = 1;
CREATE TABLE rental_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_at TEXT
);
CREATE UNIQUE INDEX rental_payments_rental_due_idx ON rental_payments (rental_id, due_date);
CREATE TABLE fines (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  resolution_number TEXT NOT NULL,
  violated_at TEXT NOT NULL,
  amount INTEGER NOT NULL,
  discount_amount INTEGER,
  discount_deadline TEXT,
  payment_deadline TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE UNIQUE INDEX fines_resolution_number_unique ON fines (resolution_number);
CREATE TABLE maintenance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  performed_at TEXT NOT NULL,
  mileage INTEGER NOT NULL,
  labor_cost INTEGER NOT NULL,
  total_cost INTEGER NOT NULL,
  notes TEXT
);
CREATE TABLE maintenance_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  record_id INTEGER NOT NULL REFERENCES maintenance_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL
);
PRAGMA user_version = 3;
`;

const tempDirs: string[] = [];

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trent-v4-mig-'));
  tempDirs.push(dir);
  return path.join(dir, 'taxi.db');
}

function getSqliteClient(database: ReturnType<typeof createDb>): Database.Database {
  return (database as unknown as { $client: Database.Database }).$client;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('v3 -> v4 idempotent database migration', () => {
  it('upgrades raw v3 file DB to v4 idempotently, preserves data, and sets owner_id to NULL on owner delete', () => {
    const dbPath = makeTempDbPath();
    const raw = new Database(dbPath);
    raw.pragma('foreign_keys = ON');
    raw.exec(V3_DDL);

    raw
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(1, 'admin', 'salt:hash', 'admin', '2026-10-01T00:00:00Z');
    raw
      .prepare(
        `INSERT INTO cars (id, plate, brand, model, status, mileage, sts_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 'А123ВС 777', 'Kia', 'Rio', 'in_rent', 120000, '99 01 112233', '2026-10-01T00:00:00Z');
    raw
      .prepare(
        `INSERT INTO drivers (id, full_name, archived, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(1, 'Иванов Алексей', 0, '2026-10-01T00:00:00Z');
    raw
      .prepare(
        `INSERT INTO rentals (id, car_id, driver_id, renter_name, rate_amount, periodicity, start_date, end_date, active, manager_commission_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 1, 1, 'Иванов Алексей', 2400, 'weekly', '2026-10-01', null, 1, 15);
    raw
      .prepare(
        `INSERT INTO rental_payments (id, rental_id, due_date, amount, paid_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(1, 1, '2026-10-08', 16800, '2026-10-08T10:00:00Z');
    raw.close();

    const db1 = createDb(dbPath);
    try {
      const userVersion = db1.get<{ user_version: number }>(sql`PRAGMA user_version`);
      expect(userVersion?.user_version).toBe(4);

      const userCols = db1.all<{ name: string }>(sql`PRAGMA table_info('users')`);
      expect(userCols.map((c) => c.name)).toContain('display_name');

      const carCols = db1.all<{ name: string }>(sql`PRAGMA table_info('cars')`);
      expect(carCols.map((c) => c.name)).toContain('owner_id');

      const [existingUser] = db1.select().from(users).all();
      expect(existingUser).toMatchObject({
        id: 1,
        username: 'admin',
        role: 'admin',
        displayName: null,
      });

      const [existingCar] = db1.select().from(cars).all();
      expect(existingCar).toMatchObject({
        id: 1,
        plate: 'А123ВС 777',
        ownerId: null,
      });

      const [existingRental] = db1.select().from(rentals).all();
      expect(existingRental).toMatchObject({
        id: 1,
        carId: 1,
        driverId: 1,
        rateAmount: 2400,
        managerCommissionPercent: 15,
      });

      const [existingPayment] = db1.select().from(rentalPayments).all();
      expect(existingPayment).toMatchObject({
        id: 1,
        rentalId: 1,
        dueDate: '2026-10-08',
        amount: 16800,
        paidAt: '2026-10-08T10:00:00Z',
      });
    } finally {
      getSqliteClient(db1).close();
    }

    // Reopening via createDb is idempotent
    const db2 = createDb(dbPath);
    try {
      const userVersion = db2.get<{ user_version: number }>(sql`PRAGMA user_version`);
      expect(userVersion?.user_version).toBe(4);

      // Calling migrateDbV4 directly on an already-v4 DB is a safe no-op
      const sqliteClient = getSqliteClient(db2);
      expect(() => migrateDbV4(sqliteClient)).not.toThrow();
      expect(Number(sqliteClient.pragma('user_version', { simple: true }))).toBe(4);

      // Create an owner user, assign car.ownerId, and verify ON DELETE SET NULL
      const [ownerUser] = db2
        .insert(users)
        .values({
          username: 'owner_test',
          displayName: 'Сергей Волков',
          passwordHash: 'salt:hash2',
          role: 'owner',
        })
        .returning()
        .all();

      db2.update(cars).set({ ownerId: ownerUser.id }).where(eq(cars.id, 1)).run();
      const [carBeforeDelete] = db2.select().from(cars).where(eq(cars.id, 1)).all();
      expect(carBeforeDelete?.ownerId).toBe(ownerUser.id);

      db2.delete(users).where(eq(users.id, ownerUser.id)).run();
      const [carAfterDelete] = db2.select().from(cars).where(eq(cars.id, 1)).all();
      expect(carAfterDelete?.ownerId).toBeNull();
    } finally {
      getSqliteClient(db2).close();
    }
  });
});
