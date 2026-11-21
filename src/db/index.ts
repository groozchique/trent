import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { resolveFineDriverId } from '../lib/fines/attribution';
import * as schema from './schema';

export type AppDb = BetterSQLite3Database<typeof schema>;

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cars (
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
CREATE UNIQUE INDEX IF NOT EXISTS cars_plate_unique ON cars (plate);
CREATE TABLE IF NOT EXISTS car_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  policy_number TEXT,
  notes TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS car_documents_car_type_idx ON car_documents (car_id, type);
CREATE TABLE IF NOT EXISTS rentals (
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
CREATE UNIQUE INDEX IF NOT EXISTS rentals_active_car_unique ON rentals (car_id) WHERE active = 1;
CREATE TABLE IF NOT EXISTS rental_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_payments_rental_due_idx
  ON rental_payments (rental_id, due_date);
CREATE TABLE IF NOT EXISTS fines (
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
CREATE UNIQUE INDEX IF NOT EXISTS fines_resolution_number_unique ON fines (resolution_number);
CREATE TABLE IF NOT EXISTS maintenance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  performed_at TEXT NOT NULL,
  mileage INTEGER NOT NULL,
  labor_cost INTEGER NOT NULL,
  total_cost INTEGER NOT NULL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS maintenance_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  record_id INTEGER NOT NULL REFERENCES maintenance_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL
);
`;

type ColumnSpec = { name: string; definition: string };

const CAR_V2_COLUMNS: ColumnSpec[] = [
  { name: 'sts_number', definition: 'TEXT' },
  { name: 'next_service_mileage', definition: 'INTEGER' },
  { name: 'next_service_date', definition: 'TEXT' },
];
const RENTAL_V2_COLUMNS: ColumnSpec[] = [
  { name: 'driver_id', definition: 'INTEGER REFERENCES drivers(id) ON DELETE SET NULL' },
  { name: 'end_date', definition: 'TEXT' },
];
const FINE_V2_COLUMNS: ColumnSpec[] = [
  { name: 'driver_id', definition: 'INTEGER REFERENCES drivers(id) ON DELETE SET NULL' },
];

function getMissingColumns(
  sqlite: Database.Database,
  tableName: string,
  columns: ColumnSpec[],
): ColumnSpec[] {
  const existing = new Set(
    (sqlite.pragma(`table_info('${tableName}')`) as Array<{ name: string }>).map((c) => c.name),
  );
  return columns.filter((col) => !existing.has(col.name));
}

function ensureColumns(
  sqlite: Database.Database,
  tableName: string,
  columns: ColumnSpec[],
): void {
  for (const col of getMissingColumns(sqlite, tableName, columns)) {
    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.definition};`);
  }
}

function getRentalIndexNames(sqlite: Database.Database): string[] {
  return (sqlite.pragma("index_list('rentals')") as Array<{ name: string }>).map((i) => i.name);
}

function hasLegacyRentalIndex(indexNames: string[]): boolean {
  return indexNames.some(
    (name) => name === 'rentals_car_id_unique' || name.startsWith('sqlite_autoindex_rentals_'),
  );
}

function rebuildRentalsTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE rentals_v2 (
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
    INSERT INTO rentals_v2 (id, car_id, driver_id, renter_name, rate_amount, periodicity, start_date, end_date, active)
    SELECT id, car_id, driver_id, renter_name, rate_amount, periodicity, start_date, end_date, active
    FROM rentals;
    DROP TABLE rentals;
    ALTER TABLE rentals_v2 RENAME TO rentals;
    CREATE UNIQUE INDEX IF NOT EXISTS rentals_active_car_unique ON rentals (car_id) WHERE active = 1;
  `);
}

function backfillDriversForRentals(sqlite: Database.Database): void {
  const orphanedRentals = sqlite
    .prepare('SELECT id, renter_name FROM rentals WHERE driver_id IS NULL ORDER BY id ASC')
    .all() as Array<{ id: number; renter_name: string }>;
  if (orphanedRentals.length === 0) return;

  // SQLite lower() only handles ASCII, so fold Russian/Unicode names in TypeScript.
  const existingDrivers = sqlite
    .prepare('SELECT id, full_name FROM drivers ORDER BY id ASC')
    .all() as Array<{ id: number; full_name: string }>;
  const driverByKey = new Map<string, number>();
  for (const driver of existingDrivers) {
    const key = driver.full_name.trim().toLowerCase();
    if (key && !driverByKey.has(key)) {
      driverByKey.set(key, driver.id);
    }
  }

  const insertDriver = sqlite.prepare(
    'INSERT INTO drivers (full_name, archived, created_at) VALUES (?, 0, ?)',
  );
  const updateRental = sqlite.prepare('UPDATE rentals SET driver_id = ? WHERE id = ?');
  const nowIso = new Date().toISOString();

  for (const rental of orphanedRentals) {
    const trimmedName = rental.renter_name.trim();
    const key = trimmedName.toLowerCase();
    if (!key) continue;

    let driverId = driverByKey.get(key);
    if (driverId === undefined) {
      const info = insertDriver.run(trimmedName, nowIso);
      driverId = Number(info.lastInsertRowid);
      driverByKey.set(key, driverId);
    }
    updateRental.run(driverId, rental.id);
  }
}

function backfillFineDrivers(sqlite: Database.Database): void {
  const unlinkedFines = sqlite
    .prepare('SELECT id, car_id, violated_at FROM fines WHERE driver_id IS NULL ORDER BY id ASC')
    .all() as Array<{ id: number; car_id: number; violated_at: string }>;
  if (unlinkedFines.length === 0) return;

  const orm = drizzle(sqlite, { schema });
  const updateFine = sqlite.prepare('UPDATE fines SET driver_id = ? WHERE id = ?');
  for (const fine of unlinkedFines) {
    const driverId = resolveFineDriverId(orm, fine.car_id, fine.violated_at);
    if (driverId !== null) {
      updateFine.run(driverId, fine.id);
    }
  }
}

const V2_SCHEMA_VERSION = 2;

function getUserVersion(sqlite: Database.Database): number {
  return Number(sqlite.pragma('user_version', { simple: true }) ?? 0);
}

/** Idempotently upgrade a v1 SQLite database to the v2 schema and backfill relations. */
export function migrateDbV2(sqlite: Database.Database): void {
  if (getUserVersion(sqlite) >= V2_SCHEMA_VERSION) return;

  const needsRentalRebuild = hasLegacyRentalIndex(getRentalIndexNames(sqlite));
  // SQLite ignores PRAGMA foreign_keys changes inside a transaction, so toggle outside.
  if (needsRentalRebuild) {
    sqlite.pragma('foreign_keys = OFF');
  }
  try {
    sqlite
      .transaction(() => {
        if (getUserVersion(sqlite) >= V2_SCHEMA_VERSION) return;

        ensureColumns(sqlite, 'cars', CAR_V2_COLUMNS);
        ensureColumns(sqlite, 'rentals', RENTAL_V2_COLUMNS);
        ensureColumns(sqlite, 'fines', FINE_V2_COLUMNS);

        if (hasLegacyRentalIndex(getRentalIndexNames(sqlite))) {
          rebuildRentalsTable(sqlite);
        } else {
          sqlite.exec(
            'CREATE UNIQUE INDEX IF NOT EXISTS rentals_active_car_unique ON rentals (car_id) WHERE active = 1;',
          );
        }

        sqlite.exec(
          'UPDATE rentals SET end_date = start_date WHERE active = 0 AND end_date IS NULL;',
        );
        backfillDriversForRentals(sqlite);
        backfillFineDrivers(sqlite);
        sqlite.pragma(`user_version = ${V2_SCHEMA_VERSION}`);
      })
      .immediate();
  } finally {
    if (needsRentalRebuild) {
      sqlite.pragma('foreign_keys = ON');
    }
  }
}

/** Create a Drizzle SQLite instance with foreign keys enabled and v2 schema migrated. */
export function createDb(filePath?: string): AppDb {
  const target = filePath ?? process.env.DATABASE_URL ?? './data/taxi.db';
  if (target !== ':memory:' && !target.startsWith('file::memory:')) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }

  const sqlite = new Database(target);
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  if (target !== ':memory:' && !target.startsWith('file::memory:')) {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.exec(INIT_SQL);
  migrateDbV2(sqlite);

  return drizzle(sqlite, { schema });
}

const globalForDb = globalThis as unknown as { __taxiDb?: AppDb };

export const db: AppDb = globalForDb.__taxiDb ?? (globalForDb.__taxiDb = createDb());
