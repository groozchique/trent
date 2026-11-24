import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, users } from '@/db/schema';
import { requireAdmin, requireAuth } from '@/lib/auth/session';
import {
  ApiError,
  getCarDetail,
  getCarSummary,
  handleApiError,
  parseCarIdParam,
  type RouteIdContext,
} from '@/lib/cars';
import { parseJsonBody, updateCarSchema } from '@/lib/validation';

export async function GET(_request: Request, context: RouteIdContext) {
  try {
    const user = await requireAuth();
    const carId = await parseCarIdParam(context);
    const car = await getCarDetail(db, carId);
    if (!car) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }
    if (user.role === 'owner' && car.ownerId !== user.id) {
      return NextResponse.json({ error: 'Недостаточно прав доступа' }, { status: 403 });
    }
    return NextResponse.json({ car });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, updateCarSchema);

    if (data.ownerId !== undefined && data.ownerId !== null) {
      const [ownerRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, data.ownerId), eq(users.role, 'owner')))
        .limit(1);
      if (!ownerRow) {
        throw new ApiError(400, 'Указанный собственник не найден');
      }
    }

    const updated = await db
      .update(cars)
      .set(data)
      .where(eq(cars.id, carId))
      .returning({ id: cars.id });

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }

    const car = await getCarSummary(db, carId);
    if (!car) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }
    return NextResponse.json({ car });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const deleted = await db
      .delete(cars)
      .where(eq(cars.id, carId))
      .returning({ id: cars.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
