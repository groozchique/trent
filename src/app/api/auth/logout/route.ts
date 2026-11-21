import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  deleteSession,
} from '@/lib/auth/session';

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await deleteSession(db, token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', buildSessionCookieOptions(0));
  return response;
}
