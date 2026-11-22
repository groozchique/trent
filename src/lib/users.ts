import { asc, count, eq } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { users } from '@/db/schema';
import type { SQLiteTx } from '@/lib/fines/attribution';
import type { SafeUserDto } from '@/lib/validation';

export const SAFE_USER_COLUMNS = {
  id: users.id,
  username: users.username,
  role: users.role,
  createdAt: users.createdAt,
};

/** Return all users without password hashes ordered by ID. */
export async function listUsersSafe(database: AppDb): Promise<SafeUserDto[]> {
  return database.select(SAFE_USER_COLUMNS).from(users).orderBy(asc(users.id));
}

/** Count existing administrator accounts inside a database or active transaction. */
export function countAdmins(database: AppDb | SQLiteTx): number {
  const row = database
    .select({ total: count() })
    .from(users)
    .where(eq(users.role, 'admin'))
    .get();
  return Number(row?.total ?? 0);
}
