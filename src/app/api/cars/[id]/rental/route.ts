import { NextResponse } from 'next/server';
import { and, eq, isNotNull, max } from 'drizzle-orm';
import { db } from '@/db';
import { cars, rentalPayments, rentals } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import {
  ApiError,
  getTodayIso,
  handleApiError,
  parseCarIdParam,
  resolveOrCreateDriverForRental,
  type RouteIdContext,
} from '@/lib/cars';
import { shiftUtcDaysIso } from '@/lib/format';
import { parseJsonBody, upsertRentalSchema, type RentalDto } from '@/lib/validation';

export async function PUT(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, upsertRentalSchema);
    const todayIso = getTodayIso();

    const result = db.transaction((tx) => {
      const car = tx
        .select({ id: cars.id, status: cars.status })
        .from(cars)
        .where(eq(cars.id, carId))
        .get();
      if (!car) return null;

      const resolvedDriver = resolveOrCreateDriverForRental(tx, {
        driverId: data.driverId,
        renterName: data.renterName,
      });

      const activeRental = tx
        .select()
        .from(rentals)
        .where(and(eq(rentals.carId, carId), eq(rentals.active, true)))
        .get();

      if (!activeRental && data.active === false) {
        throw new ApiError(400, 'Нет активной аренды для завершения');
      }

      const isExplicitDriverId = data.driverId !== undefined && data.driverId !== null;
      const isDriverSwitch =
        activeRental !== undefined &&
        isExplicitDriverId &&
        activeRental.driverId !== resolvedDriver.id;

      let shouldRolloverOnScheduleChange = false;

      if (isDriverSwitch) {
        const prevEndDate =
          data.startDate > activeRental.startDate
            ? shiftUtcDaysIso(data.startDate, -1)
            : activeRental.startDate;
        tx.update(rentals)
          .set({ active: false, endDate: prevEndDate })
          .where(eq(rentals.id, activeRental.id))
          .run();
      } else if (activeRental !== undefined && data.active) {
        const scheduleOrCommissionChanged =
          data.periodicity !== activeRental.periodicity ||
          data.startDate !== activeRental.startDate ||
          data.managerCommissionPercent !== activeRental.managerCommissionPercent;

        if (scheduleOrCommissionChanged) {
          const paidRow = tx
            .select({ lastPaidDueDate: max(rentalPayments.dueDate) })
            .from(rentalPayments)
            .where(
              and(
                eq(rentalPayments.rentalId, activeRental.id),
                isNotNull(rentalPayments.paidAt),
              ),
            )
            .get();
          const lastPaidDueDate = paidRow?.lastPaidDueDate ?? null;
          if (lastPaidDueDate !== null) {
            if (data.startDate <= lastPaidDueDate) {
              throw new ApiError(
                400,
                'Нельзя менять дату начала, периодичность или комиссию задним числом: уже есть оплаченные платежи',
              );
            }
            shouldRolloverOnScheduleChange = true;
            tx.update(rentals)
              .set({ active: false, endDate: shiftUtcDaysIso(data.startDate, -1) })
              .where(eq(rentals.id, activeRental.id))
              .run();
          }
        }
      }

      const nextEndDate =
        data.active === false
          ? data.startDate > todayIso
            ? data.startDate
            : todayIso
          : null;

      const rentalValues = {
        driverId: resolvedDriver.id,
        renterName: resolvedDriver.fullName,
        rateAmount: data.rateAmount,
        periodicity: data.periodicity,
        startDate: data.startDate,
        endDate: nextEndDate,
        active: data.active,
        managerCommissionPercent: data.managerCommissionPercent,
      };

      const savedRental =
        activeRental !== undefined && !isDriverSwitch && !shouldRolloverOnScheduleChange
          ? tx
              .update(rentals)
              .set(rentalValues)
              .where(eq(rentals.id, activeRental.id))
              .returning()
              .get()
          : tx
              .insert(rentals)
              .values({ carId, ...rentalValues })
              .returning()
              .get();

      let nextCarStatus = car.status;
      if (data.active) {
        if (car.status === 'available' && data.startDate <= todayIso) {
          nextCarStatus = 'in_rent';
          tx.update(cars).set({ status: 'in_rent' }).where(eq(cars.id, carId)).run();
        }
      } else if (car.status === 'in_rent') {
        nextCarStatus = 'available';
        tx.update(cars).set({ status: 'available' }).where(eq(cars.id, carId)).run();
      }

      const rental: RentalDto = {
        ...savedRental,
        driverPhone: resolvedDriver.phone,
      };

      return { rental, carStatus: nextCarStatus };
    });

    if (!result) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
