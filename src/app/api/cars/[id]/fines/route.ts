import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, drivers, fines } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import { ApiError, handleApiError, parseCarIdParam, type RouteIdContext } from '@/lib/cars';
import { resolveFineDriverId } from '@/lib/fines/attribution';
import { createFineSchema, parseJsonBody, type FineDto } from '@/lib/validation';

export async function POST(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, createFineSchema);

    const fine: FineDto = db.transaction((tx) => {
      const car = tx.select({ id: cars.id }).from(cars).where(eq(cars.id, carId)).get();
      if (!car) {
        throw new ApiError(404, 'Автомобиль не найден');
      }

      let driverId: number | null = null;
      let driverName: string | null = null;

      if (data.driverId !== undefined && data.driverId !== null) {
        const driver = tx
          .select({ id: drivers.id, fullName: drivers.fullName })
          .from(drivers)
          .where(eq(drivers.id, data.driverId))
          .get();
        if (!driver) {
          throw new ApiError(404, 'Водитель не найден');
        }
        driverId = driver.id;
        driverName = driver.fullName;
      } else {
        driverId = resolveFineDriverId(tx, carId, data.violatedAt);
        if (driverId !== null) {
          const driver = tx
            .select({ fullName: drivers.fullName })
            .from(drivers)
            .where(eq(drivers.id, driverId))
            .get();
          driverName = driver?.fullName ?? null;
        }
      }

      const inserted = tx
        .insert(fines)
        .values({
          carId,
          driverId,
          resolutionNumber: data.resolutionNumber,
          violatedAt: data.violatedAt,
          amount: data.amount,
          discountAmount: data.discountAmount,
          discountDeadline: data.discountDeadline,
          paymentDeadline: data.paymentDeadline,
          description: data.description,
          status: data.status,
        })
        .returning()
        .get();

      return { ...inserted, driverName };
    });

    return NextResponse.json({ fine }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
