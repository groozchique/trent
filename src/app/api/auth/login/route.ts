import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { users } from '@/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  createSession,
  type SessionUser,
} from '@/lib/auth/session';

const loginSchema = z.object(
  {
    username: z.string('Введите логин').trim().min(1, 'Введите логин'),
    password: z.string('Введите пароль').min(1, 'Введите пароль'),
  },
  'Введите логин и пароль',
);

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный формат запроса' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Введите логин и пароль' },
      { status: 400 },
    );
  }

  const { username, password } = parsed.data;
  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!userRow || !verifyPassword(password, userRow.passwordHash)) {
    return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
  }

  const { token } = await createSession(db, userRow.id);
  const user: SessionUser = {
    id: userRow.id,
    username: userRow.username,
    displayName: userRow.displayName,
    role: userRow.role,
  };

  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions());
  return response;
}
