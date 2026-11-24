import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, sessions, users, type UserRole } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { requireAdmin } from '@/lib/auth/session';
import {
  ApiError,
  handleApiError,
  requirePositiveIntParam,
  type RouteIdContext,
} from '@/lib/cars';
import { SAFE_USER_COLUMNS, countAdmins } from '@/lib/users';
import { parseJsonBody, updateUserSchema } from '@/lib/validation';

async function parseUserIdParam(context: RouteIdContext): Promise<number> {
  const { id } = await context.params;
  return requirePositiveIntParam(id, 'Некорректный идентификатор пользователя');
}

export async function PATCH(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const targetId = await parseUserIdParam(context);
    const data = await parseJsonBody(request, updateUserSchema);

    const user = db.transaction((tx) => {
      const target = tx
        .select(SAFE_USER_COLUMNS)
        .from(users)
        .where(eq(users.id, targetId))
        .get();
      if (!target) {
        throw new ApiError(404, 'Пользователь не найден');
      }

      if (data.role !== undefined && data.role !== 'admin' && target.role === 'admin') {
        if (countAdmins(tx) <= 1) {
          throw new ApiError(400, 'Нельзя снять права у последнего администратора');
        }
      }

      const updates: { role?: UserRole; passwordHash?: string; displayName?: string | null } = {};
      if (data.role !== undefined) {
        updates.role = data.role;
      }
      if (data.displayName !== undefined) {
        updates.displayName = data.displayName;
      }
      if (data.password !== undefined) {
        updates.passwordHash = hashPassword(data.password);
      }

      const updated = tx
        .update(users)
        .set(updates)
        .where(eq(users.id, targetId))
        .returning(SAFE_USER_COLUMNS)
        .get();

      if (target.role === 'owner' && data.role !== undefined && data.role !== 'owner') {
        tx.update(cars).set({ ownerId: null }).where(eq(cars.ownerId, targetId)).run();
      }

      const roleChanged = data.role !== undefined && data.role !== target.role;
      if (data.password !== undefined || roleChanged) {
        tx.delete(sessions).where(eq(sessions.userId, targetId)).run();
      }

      return updated;
    });

    return NextResponse.json({ user });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_request: Request, context: RouteIdContext) {
  try {
    const currentUser = await requireAdmin();
    const targetId = await parseUserIdParam(context);

    db.transaction((tx) => {
      if (targetId === currentUser.id) {
        throw new ApiError(400, 'Нельзя удалить текущего пользователя');
      }

      const target = tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, targetId))
        .get();
      if (!target) {
        throw new ApiError(404, 'Пользователь не найден');
      }

      if (target.role === 'admin' && countAdmins(tx) <= 1) {
        throw new ApiError(400, 'Нельзя удалить последнего администратора');
      }

      tx.delete(users).where(eq(users.id, targetId)).run();
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
