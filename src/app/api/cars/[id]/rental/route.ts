import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, rentals } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import { handleApiError, parseCarIdParam, type RouteIdContext } from '@/lib/cars';
import { parseJsonBody, upsertRentalSchema } from '@/lib/validation';

export async function PUT(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, upsertRentalSchema);

    const [car] = await db
      .select({ id: cars.id })
      .from(cars)
      .where(eq(cars.id, carId))
      .limit(1);
    if (!car) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }

    const [rental] = await db
      .insert(rentals)
      .values({ carId, ...data })
      .onConflictDoUpdate({
        target: rentals.carId,
        set: data,
      })
      .returning();

    return NextResponse.json({ rental });
  } catch (err) {
    return handleApiError(err);
  }
}
