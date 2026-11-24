import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, type AppDb } from '@/db';
import { sessions, users, type UserRole } from '@/db/schema';

export const SESSION_COOKIE_NAME = 'taxi_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export type SessionUser = {
  id: number;
  username: string;
  displayName?: string | null;
  role: UserRole;
};

export class AuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message?: string) {
    super(message ?? (status === 401 ? 'Требуется авторизация' : 'Недостаточно прав доступа'));
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Build HttpOnly SameSite=Lax cookie options for session cookies. */
export function buildSessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge,
  };
}

/** Create a 32-byte random hex session valid for 7 days. */
export async function createSession(
  database: AppDb,
  userId: number,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await database.insert(sessions).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

/** Resolve active session user; deletes and rejects expired sessions. */
export async function getSessionUser(
  database: AppDb,
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;

  const [row] = await database
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    await database.delete(sessions).where(eq(sessions.id, token));
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
  };
}

/** Revoke a session token from the database. */
export async function deleteSession(database: AppDb, token: string): Promise<void> {
  if (!token) return;
  await database.delete(sessions).where(eq(sessions.id, token));
}

/** Read `taxi_session` cookie and return the authenticated user or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getSessionUser(db, token);
}

/** Ensure request has a valid session; throws AuthError(401) otherwise. */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401);
  return user;
}

/** Ensure request belongs to an admin user; throws AuthError(401 | 403). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== 'admin') throw new AuthError(403);
  return user;
}

/** Ensure request belongs to a staff user (`admin` or `viewer`), rejecting `owner` with 403. */
export async function requireStaff(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role === 'owner') throw new AuthError(403);
  return user;
}
