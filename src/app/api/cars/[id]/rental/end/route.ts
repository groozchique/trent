import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, drivers, rentals, type CarStatus } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import {
  ApiError,
  getTodayIso,
  handleApiError,
  parseCarIdParam,
  type RouteIdContext,
} from '@/lib/cars';
import { endRentalSchema, parseJsonBody, type RentalDto } from '@/lib/validation';

export async function POST(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, endRentalSchema, { allowEmpty: true });
    const todayIso = getTodayIso();

    const result = db.transaction((tx) => {
      const car = tx
        .select({ id: cars.id, status: cars.status })
        .from(cars)
        .where(eq(cars.id, carId))
        .get();
      if (!car) {
        throw new ApiError(404, 'Автомобиль не найден');
      }

      const activeRental = tx
        .select()
        .from(rentals)
        .where(and(eq(rentals.carId, carId), eq(rentals.active, true)))
        .get();
      if (!activeRental) {
        throw new ApiError(404, 'Активная аренда не найдена');
      }

      const endDate = data.endDate ?? todayIso;
      if (endDate < activeRental.startDate) {
        throw new ApiError(400, 'Дата окончания не может быть раньше даты начала аренды');
      }

      const closed = tx
        .update(rentals)
        .set({ active: false, endDate })
        .where(eq(rentals.id, activeRental.id))
        .returning()
        .get();

      const nextStatus: CarStatus = car.status === 'in_rent' ? 'available' : car.status;
      if (nextStatus !== car.status) {
        tx.update(cars).set({ status: nextStatus }).where(eq(cars.id, carId)).run();
      }

      const driver =
        closed.driverId !== null
          ? tx
              .select({ fullName: drivers.fullName, phone: drivers.phone })
              .from(drivers)
              .where(eq(drivers.id, closed.driverId))
              .get()
          : undefined;

      const rental: RentalDto = {
        ...closed,
        renterName: driver?.fullName ?? closed.renterName,
        driverPhone: driver?.phone ?? null,
      };

      return { rental, carStatus: nextStatus };
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
