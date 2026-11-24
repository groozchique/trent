import { asc, count, eq } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { users } from '@/db/schema';
import type { SQLiteTx } from '@/lib/fines/attribution';
import type { OwnerOptionDto, SafeUserDto } from '@/lib/validation';

export const SAFE_USER_COLUMNS = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  role: users.role,
  createdAt: users.createdAt,
};

/** Resolve display label for a user (`displayName` if non-blank, otherwise `username`). */
export function formatUserLabel(user: { username: string; displayName?: string | null }): string {
  return user.displayName?.trim() || user.username;
}

/** Return all users without password hashes ordered by ID. */
export async function listUsersSafe(database: AppDb): Promise<SafeUserDto[]> {
  return database.select(SAFE_USER_COLUMNS).from(users).orderBy(asc(users.id));
}

/** Return all owner accounts ordered by ID with resolved display labels. */
export async function listOwners(database: AppDb): Promise<OwnerOptionDto[]> {
  const rows = await database
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.role, 'owner'))
    .orderBy(asc(users.id));

  return rows.map((row) => ({
    ...row,
    label: formatUserLabel(row),
  }));
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
