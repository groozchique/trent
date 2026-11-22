import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { drivers, rentals } from '@/db/schema';
import { requireAdmin, requireAuth } from '@/lib/auth/session';
import {
  ApiError,
  handleApiError,
  requirePositiveIntParam,
  type RouteIdContext,
} from '@/lib/cars';
import { getDriverDetail } from '@/lib/drivers';
import { parseJsonBody, updateDriverSchema } from '@/lib/validation';

async function parseDriverIdParam(context: RouteIdContext): Promise<number> {
  const { id } = await context.params;
  return requirePositiveIntParam(id, 'Некорректный идентификатор водителя');
}

export async function GET(_request: Request, context: RouteIdContext) {
  try {
    await requireAuth();
    const driverId = await parseDriverIdParam(context);
    const driver = await getDriverDetail(db, driverId);
    if (!driver) {
      return NextResponse.json({ error: 'Водитель не найден' }, { status: 404 });
    }
    return NextResponse.json({ driver });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const driverId = await parseDriverIdParam(context);
    const data = await parseJsonBody(request, updateDriverSchema);

    db.transaction((tx) => {
      const existing = tx
        .select({ id: drivers.id })
        .from(drivers)
        .where(eq(drivers.id, driverId))
        .get();
      if (!existing) {
        throw new ApiError(404, 'Водитель не найден');
      }

      if (data.archived === true) {
        const activeRental = tx
          .select({ id: rentals.id })
          .from(rentals)
          .where(and(eq(rentals.driverId, driverId), eq(rentals.active, true)))
          .limit(1)
          .get();
        if (activeRental) {
          throw new ApiError(409, 'Нельзя архивировать водителя с активной арендой');
        }
      }

      tx.update(drivers).set(data).where(eq(drivers.id, driverId)).run();
    });

    const driver = await getDriverDetail(db, driverId);
    if (!driver) {
      return NextResponse.json({ error: 'Водитель не найден' }, { status: 404 });
    }
    return NextResponse.json({ driver });
  } catch (err) {
    return handleApiError(err);
  }
}
