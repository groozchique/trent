import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '@/db';
import { drivers, fines, rentalPayments, rentals } from '@/db/schema';
import { resolveFineDriverId } from '@/lib/fines/attribution';

const V1_DDL = `
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
CREATE TABLE cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  plate TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  mileage INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX cars_plate_unique ON cars (plate);
CREATE TABLE rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  renter_name TEXT NOT NULL,
  rate_amount INTEGER NOT NULL,
  periodicity TEXT NOT NULL,
  start_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX rentals_car_id_unique ON rentals (car_id);
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
`;

const tempDirs: string[] = [];

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trent-v2-mig-'));
  tempDirs.push(dir);
  return path.join(dir, 'taxi.db');
}

function closeAppDb(database: ReturnType<typeof createDb>): void {
  const withClient = database as unknown as { $client?: Database.Database };
  withClient.$client?.close();
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('v1 -> v2 idempotent database migration', () => {
  it('migrates raw v1 file DB idempotently without losing IDs or payments', () => {
    const dbPath = makeTempDbPath();
    const raw = new Database(dbPath);
    raw.pragma('foreign_keys = ON');
    raw.exec(V1_DDL);

    raw
      .prepare(
        `INSERT INTO cars (id, plate, brand, model, status, mileage, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(10, 'А123ВС 777', 'Kia', 'Rio', 'in_rent', 140000, '2026-10-01T00:00:00.000Z');
    raw
      .prepare(
        `INSERT INTO cars (id, plate, brand, model, status, mileage, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(20, 'В456ОР 777', 'Hyundai', 'Solaris', 'available', 95000, '2026-10-01T00:00:00.000Z');

    raw
      .prepare(
        `INSERT INTO rentals (id, car_id, renter_name, rate_amount, periodicity, start_date, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(101, 10, 'Иванов Алексей Сергеевич', 2400, 'weekly', '2026-10-01', 1);
    raw
      .prepare(
        `INSERT INTO rentals (id, car_id, renter_name, rate_amount, periodicity, start_date, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(102, 20, 'Петров Олег', 2100, 'daily', '2026-10-10', 0);

    raw
      .prepare(
        `INSERT INTO rental_payments (id, rental_id, due_date, amount, paid_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(201, 101, '2026-10-01', 2400, '2026-10-01T12:00:00Z');
    raw
      .prepare(
        `INSERT INTO rental_payments (id, rental_id, due_date, amount, paid_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(202, 102, '2026-10-10', 2100, '2026-10-10T18:00:00Z');

    raw
      .prepare(
        `INSERT INTO fines (id, car_id, resolution_number, violated_at, amount, discount_amount, discount_deadline, payment_deadline, description, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        301,
        10,
        '18810177261000000001',
        '2026-10-15T14:20:00+03:00',
        750,
        562,
        '2026-11-04',
        '2026-12-14',
        'Превышение скорости',
        'unpaid',
      );
    raw
      .prepare(
        `INSERT INTO fines (id, car_id, resolution_number, violated_at, amount, discount_amount, discount_deadline, payment_deadline, description, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        302,
        10,
        '18810177261000000002',
        '2026-09-20T09:00:00+03:00',
        1500,
        null,
        null,
        '2026-11-19',
        'Штраф до начала аренды',
        'unpaid',
      );
    raw
      .prepare(
        `INSERT INTO fines (id, car_id, resolution_number, violated_at, amount, discount_amount, discount_deadline, payment_deadline, description, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        303,
        20,
        '18810177261000000003',
        '2026-10-10T16:00:00+03:00',
        500,
        375,
        '2026-10-30',
        '2026-12-09',
        'Нарушение разметки',
        'paid',
      );
    raw.close();

    // Open twice to verify idempotency
    const db1 = createDb(dbPath);
    closeAppDb(db1);
    const db2 = createDb(dbPath);

    try {
      const fkState = db2.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);
      expect(fkState?.foreign_keys).toBe(1);
      expect(db2.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

      const driverRows = db2.select().from(drivers).all();
      expect(driverRows.map((d) => d.fullName).sort()).toEqual([
        'Иванов Алексей Сергеевич',
        'Петров Олег',
      ]);
      const ivanov = driverRows.find((d) => d.fullName === 'Иванов Алексей Сергеевич')!;
      const petrov = driverRows.find((d) => d.fullName === 'Петров Олег')!;

      const rentalRows = db2.select().from(rentals).all();
      expect(rentalRows.map((r) => r.id).sort((a, b) => a - b)).toEqual([101, 102]);
      const r101 = rentalRows.find((r) => r.id === 101)!;
      const r102 = rentalRows.find((r) => r.id === 102)!;
      expect(r101.driverId).toBe(ivanov.id);
      expect(r101.endDate).toBeNull();
      expect(r102.driverId).toBe(petrov.id);
      expect(r102.endDate).toBe('2026-10-10');

      const paymentRows = db2.select().from(rentalPayments).all();
      expect(paymentRows).toHaveLength(2);
      expect(paymentRows.map((p) => ({ id: p.id, rentalId: p.rentalId }))).toEqual([
        { id: 201, rentalId: 101 },
        { id: 202, rentalId: 102 },
      ]);

      const fineRows = db2.select().from(fines).all();
      expect(fineRows.map((f) => f.id).sort((a, b) => a - b)).toEqual([301, 302, 303]);
      expect(fineRows.find((f) => f.id === 301)?.driverId).toBe(ivanov.id);
      expect(fineRows.find((f) => f.id === 302)?.driverId).toBeNull();
      expect(fineRows.find((f) => f.id === 303)?.driverId).toBe(petrov.id);

      const indexes = db2.all<{ name: string }>(sql`PRAGMA index_list('rentals')`);
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).not.toContain('rentals_car_id_unique');
      expect(indexNames.some((n) => n.startsWith('sqlite_autoindex_rentals_'))).toBe(false);
      expect(indexNames).toContain('rentals_active_car_unique');

      // Car 20 has historical rental 102 (active: false): another historical + new active rental coexist
      db2
        .insert(rentals)
        .values({
          carId: 20,
          driverId: petrov.id,
          renterName: petrov.fullName,
          rateAmount: 2200,
          periodicity: 'daily',
          startDate: '2026-10-11',
          endDate: '2026-10-20',
          active: false,
        })
        .run();
      db2
        .insert(rentals)
        .values({
          carId: 20,
          driverId: ivanov.id,
          renterName: ivanov.fullName,
          rateAmount: 2300,
          periodicity: 'daily',
          startDate: '2026-10-21',
          endDate: null,
          active: true,
        })
        .run();

      // Two active: true rentals on the same car_id must still reject with UNIQUE error
      expect(() =>
        db2
          .insert(rentals)
          .values({
            carId: 10,
            driverId: petrov.id,
            renterName: petrov.fullName,
            rateAmount: 2500,
            periodicity: 'daily',
            startDate: '2026-11-01',
            active: true,
          })
          .run(),
      ).toThrow(/UNIQUE/);

      const userVersion = db2.get<{ user_version: number }>(sql`PRAGMA user_version`);
      expect(userVersion?.user_version).toBe(3);
    } finally {
      closeAppDb(db2);
    }
  });

  it('does not resurrect deleted drivers or re-scan unattributed fines on subsequent createDb calls', () => {
    const dbPath = makeTempDbPath();
    const raw = new Database(dbPath);
    raw.pragma('foreign_keys = ON');
    raw.exec(V1_DDL);
    raw
      .prepare(
        `INSERT INTO cars (id, plate, brand, model, status, mileage, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 'К777КК 77', 'Kia', 'Rio', 'in_rent', 50000, '2026-10-01T00:00:00Z');
    raw
      .prepare(
        `INSERT INTO rentals (id, car_id, renter_name, rate_amount, periodicity, start_date, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 1, 'Сидоров Иван', 2000, 'daily', '2026-10-01', 1);
    raw
      .prepare(
        `INSERT INTO fines (id, car_id, resolution_number, violated_at, amount, discount_amount, discount_deadline, payment_deadline, description, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        1,
        1,
        '18810177261000009001',
        '2026-10-15T12:00:00+03:00',
        1000,
        null,
        null,
        '2026-12-15',
        'Превышение',
        'unpaid',
      );
    raw.close();

    const db1 = createDb(dbPath);
    try {
      const migratedDrivers = db1.select().from(drivers).all();
      expect(migratedDrivers).toHaveLength(1);
      const driverId = migratedDrivers[0].id;
      expect(db1.select().from(rentals).get()?.driverId).toBe(driverId);
      expect(db1.select().from(fines).get()?.driverId).toBe(driverId);

      // Delete the driver in v2 -> ON DELETE SET NULL clears rentals.driver_id and fines.driver_id
      db1.delete(drivers).where(eq(drivers.id, driverId)).run();
      expect(db1.select().from(drivers).all()).toHaveLength(0);
      expect(db1.select().from(rentals).get()?.driverId).toBeNull();
      expect(db1.select().from(fines).get()?.driverId).toBeNull();
    } finally {
      closeAppDb(db1);
    }

    // Reopening via createDb must NOT recreate the deleted driver or re-link rentals/fines
    const db2 = createDb(dbPath);
    try {
      expect(db2.select().from(drivers).all()).toHaveLength(0);
      const rentalAfter = db2.select().from(rentals).get();
      const fineAfter = db2.select().from(fines).get();
      expect(rentalAfter?.driverId).toBeNull();
      expect(rentalAfter?.renterName).toBe('Сидоров Иван');
      expect(fineAfter?.driverId).toBeNull();
      expect(db2.get<{ user_version: number }>(sql`PRAGMA user_version`)?.user_version).toBe(3);
    } finally {
      closeAppDb(db2);
    }
  });

  it('rebuilds rentals with sqlite_autoindex and deduplicates Cyrillic driver names case-insensitively', () => {
    const dbPath = makeTempDbPath();
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE cars (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        plate TEXT NOT NULL UNIQUE,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        mileage INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE rentals (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        car_id INTEGER NOT NULL UNIQUE REFERENCES cars(id) ON DELETE CASCADE,
        renter_name TEXT NOT NULL,
        rate_amount INTEGER NOT NULL,
        periodicity TEXT NOT NULL,
        start_date TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE rental_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
        due_date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        paid_at TEXT
      );
      CREATE TABLE fines (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
        resolution_number TEXT NOT NULL UNIQUE,
        violated_at TEXT NOT NULL,
        amount INTEGER NOT NULL,
        discount_amount INTEGER,
        discount_deadline TEXT,
        payment_deadline TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL
      );
      INSERT INTO cars (id, plate, brand, model, status, mileage, created_at)
        VALUES (1, 'А111АА 77', 'Kia', 'Rio', 'in_rent', 1000, '2026-10-01T00:00:00Z');
      INSERT INTO cars (id, plate, brand, model, status, mileage, created_at)
        VALUES (2, 'В222ВВ 77', 'Kia', 'Rio', 'in_rent', 2000, '2026-10-01T00:00:00Z');
      INSERT INTO rentals (id, car_id, renter_name, rate_amount, periodicity, start_date, active)
        VALUES (1, 1, 'Иванов Алексей Сергеевич', 2000, 'daily', '2026-10-01', 1);
      INSERT INTO rentals (id, car_id, renter_name, rate_amount, periodicity, start_date, active)
        VALUES (2, 2, '  иванов алексей сергеевич  ', 2100, 'daily', '2026-10-05', 1);
    `);
    raw.close();

    const db = createDb(dbPath);
    try {
      const driverRows = db.select().from(drivers).all();
      expect(driverRows).toHaveLength(1);
      expect(driverRows[0].fullName).toBe('Иванов Алексей Сергеевич');

      const rentalRows = db.select().from(rentals).all();
      expect(rentalRows.every((r) => r.driverId === driverRows[0].id)).toBe(true);

      const indexes = db.all<{ name: string }>(sql`PRAGMA index_list('rentals')`);
      expect(indexes.some((i) => i.name.startsWith('sqlite_autoindex_rentals_'))).toBe(false);
      expect(indexes.map((i) => i.name)).toContain('rentals_active_car_unique');
    } finally {
      closeAppDb(db);
    }
  });

  it('migrates v2 database to v3 by adding manager_commission_percent with default 0 idempotently', () => {
    const dbPath = makeTempDbPath();
    const raw = new Database(dbPath);
    raw.pragma('foreign_keys = ON');
    raw.exec(`
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
        active INTEGER NOT NULL DEFAULT 1
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
      PRAGMA user_version = 2;
    `);
    raw
      .prepare(
        `INSERT INTO cars (id, plate, brand, model, status, mileage, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 'Н001НН 777', 'Kia', 'Rio', 'in_rent', 50000, '2026-10-01T00:00:00Z');
    raw
      .prepare(
        `INSERT INTO drivers (id, full_name, archived, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(1, 'Козлов Павел', 0, '2026-10-01T00:00:00Z');
    raw
      .prepare(
        `INSERT INTO rentals (id, car_id, driver_id, renter_name, rate_amount, periodicity, start_date, end_date, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 1, 1, 'Козлов Павел', 2200, 'daily', '2026-10-01', null, 1);
    raw.close();

    const db1 = createDb(dbPath);
    try {
      const userVersion = db1.get<{ user_version: number }>(sql`PRAGMA user_version`);
      expect(userVersion?.user_version).toBe(3);

      const cols = db1.all<{ name: string }>(sql`PRAGMA table_info('rentals')`);
      expect(cols.map((c) => c.name)).toContain('manager_commission_percent');

      const [rental] = db1.select().from(rentals).all();
      expect(rental).toMatchObject({
        id: 1,
        carId: 1,
        driverId: 1,
        renterName: 'Козлов Павел',
        rateAmount: 2200,
        managerCommissionPercent: 0,
      });
    } finally {
      closeAppDb(db1);
    }

    const db2 = createDb(dbPath);
    try {
      const userVersion = db2.get<{ user_version: number }>(sql`PRAGMA user_version`);
      expect(userVersion?.user_version).toBe(3);
      const [rental] = db2.select().from(rentals).all();
      expect(rental?.managerCommissionPercent).toBe(0);
    } finally {
      closeAppDb(db2);
    }
  });
});

describe('resolveFineDriverId', () => {
  it('resolves driver across closed, active, out-of-range, and boundary rentals synchronously', () => {
    const db = createDb(':memory:');
    try {
      const [driverA, driverB] = db
        .insert(drivers)
        .values([{ fullName: 'Водитель Первый' }, { fullName: 'Водитель Второй' }])
        .returning()
        .all();

      const carRes = db.run(
        sql`INSERT INTO cars (plate, brand, model, status, mileage, created_at)
            VALUES ('Е001КХ 777', 'Skoda', 'Octavia', 'in_rent', 50000, '2026-09-01T00:00:00Z')`,
      );
      const carId = Number(carRes.lastInsertRowid);

      db.insert(rentals)
        .values([
          {
            carId,
            driverId: driverA.id,
            renterName: driverA.fullName,
            rateAmount: 2000,
            periodicity: 'daily',
            startDate: '2026-10-01',
            endDate: '2026-10-10',
            active: false,
          },
          {
            carId,
            driverId: driverB.id,
            renterName: driverB.fullName,
            rateAmount: 2200,
            periodicity: 'daily',
            startDate: '2026-10-10',
            endDate: null,
            active: true,
          },
        ])
        .run();

      // Before any rental
      expect(resolveFineDriverId(db, carId, '2026-09-30T23:59:00+03:00')).toBeNull();
      // Within closed rental
      expect(resolveFineDriverId(db, carId, '2026-10-05T12:00:00+03:00')).toBe(driverA.id);
      // Boundary where older closed rental ends and newer rental starts (start_date DESC, id DESC -> driverB)
      expect(resolveFineDriverId(db, carId, '2026-10-10T10:00:00+03:00')).toBe(driverB.id);
      // Within open active rental
      expect(resolveFineDriverId(db, carId, '2026-11-20T08:15:00+03:00')).toBe(driverB.id);
      // Different car ID
      expect(resolveFineDriverId(db, carId + 99, '2026-11-20T08:15:00+03:00')).toBeNull();

      // Works synchronously inside db.transaction
      const txResult = db.transaction((tx) => resolveFineDriverId(tx, carId, '2026-10-02T15:00:00+03:00'));
      expect(txResult).toBe(driverA.id);

      // Picks higher id when start_date ties on closed rentals
      db.update(rentals).set({ endDate: '2026-10-20', active: false }).where(eq(rentals.driverId, driverB.id)).run();
      db.insert(rentals)
        .values({
          carId,
          driverId: driverA.id,
          renterName: driverA.fullName,
          rateAmount: 2300,
          periodicity: 'daily',
          startDate: '2026-10-10',
          endDate: '2026-10-25',
          active: false,
        })
        .run();
      expect(resolveFineDriverId(db, carId, '2026-10-15T12:00:00+03:00')).toBe(driverA.id);
      expect(resolveFineDriverId(db, carId, '2026-10-26T12:00:00+03:00')).toBeNull();
    } finally {
      closeAppDb(db);
    }
  });
});
