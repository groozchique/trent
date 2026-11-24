import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { requireAdmin } from '@/lib/auth/session';
import { handleApiError } from '@/lib/cars';
import { SAFE_USER_COLUMNS, listUsersSafe } from '@/lib/users';
import { createUserSchema, parseJsonBody } from '@/lib/validation';

export async function GET() {
  try {
    await requireAdmin();
    const list = await listUsersSafe(db);
    return NextResponse.json({ users: list });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const data = await parseJsonBody(request, createUserSchema);
    const passwordHash = hashPassword(data.password);

    const [user] = await db
      .insert(users)
      .values({
        username: data.username,
        displayName: data.displayName ?? null,
        passwordHash,
        role: data.role,
      })
      .returning(SAFE_USER_COLUMNS);

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
