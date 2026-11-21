import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, fines } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import { handleApiError, parseCarIdParam, type RouteIdContext } from '@/lib/cars';
import { createFineSchema, parseJsonBody } from '@/lib/validation';

export async function POST(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, createFineSchema);

    const [car] = await db
      .select({ id: cars.id })
      .from(cars)
      .where(eq(cars.id, carId))
      .limit(1);
    if (!car) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }

    const [fine] = await db
      .insert(fines)
      .values({ carId, ...data })
      .returning();

    return NextResponse.json({ fine }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
