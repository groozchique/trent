import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, type AppDb } from '@/db';
import { sessions, users } from '@/db/schema';
import { seedDatabase } from '@/db/seed';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  AuthError,
  SESSION_COOKIE_NAME,
  createSession,
  deleteSession,
  getCurrentUser,
  getSessionUser,
  requireAdmin,
  requireAuth,
} from '@/lib/auth/session';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as logoutPost } from '@/app/api/auth/logout/route';
import { GET as meGet } from '@/app/api/auth/me/route';

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

describe('password hashing and sessions', () => {
  it('hashes and verifies password with per-call random salt', () => {
    const h1 = hashPassword('secret123');
    const h2 = hashPassword('secret123');
    expect(h1).not.toBe(h2);
    expect(verifyPassword('secret123', h1)).toBe(true);
    expect(verifyPassword('wrong', h1)).toBe(false);
    expect(verifyPassword('secret123', '')).toBe(false);
    expect(verifyPassword('secret123', ':')).toBe(false);
    expect(verifyPassword('secret123', 'malformed')).toBe(false);
    expect(verifyPassword('secret123', 'salt:abc')).toBe(false);
    expect(verifyPassword('secret123', 'salt:not-hex!')).toBe(false);
  });

  it('verifies seeded admin123 and viewer123 password hashes', async () => {
    const localDb = createDb(':memory:');
    await seedDatabase(localDb);

    const [admin] = await localDb.select().from(users).where(eq(users.username, 'admin'));
    const [viewer] = await localDb.select().from(users).where(eq(users.username, 'viewer'));

    expect(verifyPassword('admin123', admin.passwordHash)).toBe(true);
    expect(verifyPassword('wrong', admin.passwordHash)).toBe(false);
    expect(verifyPassword('viewer123', viewer.passwordHash)).toBe(true);
    expect(verifyPassword('admin123', viewer.passwordHash)).toBe(false);
  });

  it('creates, resolves, and revokes sessions', async () => {
    const localDb = createDb(':memory:');
    await seedDatabase(localDb);
    const [admin] = await localDb.select().from(users).where(eq(users.username, 'admin'));

    const { token, expiresAt } = await createSession(localDb, admin.id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const user = await getSessionUser(localDb, token);
    expect(user).toEqual({ id: admin.id, username: 'admin', role: 'admin' });
    expect(await getSessionUser(localDb, undefined)).toBeNull();
    expect(await getSessionUser(localDb, 'nonexistent')).toBeNull();

    await deleteSession(localDb, token);
    expect(await getSessionUser(localDb, token)).toBeNull();
  });

  it('rejects and deletes expired sessions', async () => {
    const localDb = createDb(':memory:');
    await seedDatabase(localDb);
    const [viewer] = await localDb.select().from(users).where(eq(users.username, 'viewer'));

    const expiredToken = 'a'.repeat(64);
    await localDb.insert(sessions).values({
      id: expiredToken,
      userId: viewer.id,
      expiresAt: Date.now() - 1000,
    });

    expect(await getSessionUser(localDb, expiredToken)).toBeNull();
    const remaining = await localDb.select().from(sessions).where(eq(sessions.id, expiredToken));
    expect(remaining).toHaveLength(0);
  });
});

describe('RBAC helpers and auth API routes', () => {
  beforeAll(async () => {
    if (!mockState.db) throw new Error('Test DB not initialized');
    await seedDatabase(mockState.db);
  });

  beforeEach(async () => {
    mockState.cookieJar.clear();
    if (mockState.db) {
      await mockState.db.delete(sessions);
    }
  });

  it('throws AuthError 401 when unauthenticated and 403 when viewer calls requireAdmin', async () => {
    await expect(getCurrentUser()).resolves.toBeNull();

    await expect(requireAuth()).rejects.toSatisfy(
      (err: unknown) => err instanceof AuthError && err.status === 401,
    );
    await expect(requireAdmin()).rejects.toSatisfy(
      (err: unknown) => err instanceof AuthError && err.status === 401,
    );

    const [viewer] = await mockState.db!.select().from(users).where(eq(users.username, 'viewer'));
    const viewerSession = await createSession(mockState.db!, viewer.id);
    mockState.cookieJar.set(SESSION_COOKIE_NAME, viewerSession.token);

    await expect(requireAuth()).resolves.toEqual({
      id: viewer.id,
      username: 'viewer',
      role: 'viewer',
    });
    await expect(requireAdmin()).rejects.toSatisfy(
      (err: unknown) => err instanceof AuthError && err.status === 403,
    );

    const [admin] = await mockState.db!.select().from(users).where(eq(users.username, 'admin'));
    const adminSession = await createSession(mockState.db!, admin.id);
    mockState.cookieJar.set(SESSION_COOKIE_NAME, adminSession.token);

    await expect(requireAdmin()).resolves.toEqual({
      id: admin.id,
      username: 'admin',
      role: 'admin',
    });
  });

  it('logs in seeded admin/viewer, resolves /api/auth/me, and logs out', async () => {
    const unauthMe = await meGet();
    expect(unauthMe.status).toBe(401);

    const badReq = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    const badRes = await loginPost(badReq);
    expect(badRes.status).toBe(401);

    const badJsonReq = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    const badJsonRes = await loginPost(badJsonReq);
    expect(badJsonRes.status).toBe(400);

    const invalidReq = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '', password: '' }),
    });
    const invalidRes = await loginPost(invalidReq);
    expect(invalidRes.status).toBe(400);

    for (const [payload, expectedError] of [
      [{}, 'Введите логин'],
      [null, 'Введите логин и пароль'],
      [{ username: 123, password: 'x' }, 'Введите логин'],
      [{ username: 'admin', password: 123 }, 'Введите пароль'],
    ] as const) {
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const res = await loginPost(req);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe(expectedError);
      expect(body.error).not.toMatch(/invalid input|expected/i);
    }

    const adminReq = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const adminRes = await loginPost(adminReq);
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as { user: Record<string, unknown> };
    expect(adminBody.user).toMatchObject({ username: 'admin', role: 'admin' });
    expect(adminBody.user).not.toHaveProperty('passwordHash');

    const cookie = adminRes.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');

    mockState.cookieJar.set(SESSION_COOKIE_NAME, cookie!.value);
    const meRes = await meGet();
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { user: Record<string, unknown> };
    expect(meBody.user).toMatchObject({ username: 'admin', role: 'admin' });

    const logoutRes = await logoutPost();
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('');
    expect(logoutRes.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);

    mockState.cookieJar.delete(SESSION_COOKIE_NAME);
    expect((await meGet()).status).toBe(401);
    const sessionsAfterLogout = await mockState.db!.select().from(sessions);
    expect(sessionsAfterLogout).toHaveLength(0);

    const viewerReq = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer123' }),
    });
    const viewerRes = await loginPost(viewerReq);
    expect(viewerRes.status).toBe(200);
    const viewerBody = (await viewerRes.json()) as { user: Record<string, unknown> };
    expect(viewerBody.user).toMatchObject({ username: 'viewer', role: 'viewer' });

    const [viewerRow] = await mockState.db!.select().from(users).where(eq(users.username, 'viewer'));
    const expiredToken = 'b'.repeat(64);
    await mockState.db!.insert(sessions).values({
      id: expiredToken,
      userId: viewerRow.id,
      expiresAt: Date.now() - 500,
    });
    mockState.cookieJar.set(SESSION_COOKIE_NAME, expiredToken);
    expect((await meGet()).status).toBe(401);
    const leftover = await mockState.db!
      .select()
      .from(sessions)
      .where(eq(sessions.id, expiredToken));
    expect(leftover).toHaveLength(0);
  });
});
