import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
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
CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  plate TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  mileage INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cars_plate_unique ON cars (plate);
CREATE TABLE IF NOT EXISTS rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  renter_name TEXT NOT NULL,
  rate_amount INTEGER NOT NULL,
  periodicity TEXT NOT NULL,
  start_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS rentals_car_id_unique ON rentals (car_id);
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

/** Create a Drizzle SQLite instance with foreign keys enabled and tables ensured. */
export function createDb(filePath?: string): AppDb {
  const target = filePath ?? process.env.DATABASE_URL ?? './data/taxi.db';
  if (target !== ':memory:' && !target.startsWith('file::memory:')) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }

  const sqlite = new Database(target);
  sqlite.pragma('foreign_keys = ON');
  if (target !== ':memory:' && !target.startsWith('file::memory:')) {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.exec(INIT_SQL);

  return drizzle(sqlite, { schema });
}

const globalForDb = globalThis as unknown as { __taxiDb?: AppDb };

export const db: AppDb = globalForDb.__taxiDb ?? (globalForDb.__taxiDb = createDb());
