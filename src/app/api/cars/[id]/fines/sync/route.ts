import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import { handleApiError, parseCarIdParam, type RouteIdContext } from '@/lib/cars';
import { syncCarFines } from '@/lib/fines/sync';

export async function POST(_request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);

    const [car] = await db
      .select({ id: cars.id, plate: cars.plate, stsNumber: cars.stsNumber })
      .from(cars)
      .where(eq(cars.id, carId))
      .limit(1);
    if (!car) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }

    const result = await syncCarFines(db, car.id, car.plate, { stsNumber: car.stsNumber });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
