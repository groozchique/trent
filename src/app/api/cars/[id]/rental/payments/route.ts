import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, rentalPayments, rentals } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import { handleApiError, parseCarIdParam, type RouteIdContext } from '@/lib/cars';
import { parseJsonBody, rentalPaymentSchema } from '@/lib/validation';

export async function POST(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, rentalPaymentSchema);

    const [car] = await db
      .select({ id: cars.id })
      .from(cars)
      .where(eq(cars.id, carId))
      .limit(1);
    if (!car) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }

    const rentalCondition =
      data.rentalId !== undefined
        ? and(eq(rentals.id, data.rentalId), eq(rentals.carId, carId))
        : and(eq(rentals.carId, carId), eq(rentals.active, true));

    const [rental] = await db
      .select({
        id: rentals.id,
        rateAmount: rentals.rateAmount,
        startDate: rentals.startDate,
        endDate: rentals.endDate,
      })
      .from(rentals)
      .where(rentalCondition)
      .limit(1);
    if (!rental) {
      return NextResponse.json(
        {
          error:
            data.rentalId !== undefined
              ? 'Аренда не найдена'
              : 'Аренда для автомобиля не настроена',
        },
        { status: 404 },
      );
    }

    if (
      data.dueDate < rental.startDate ||
      (rental.endDate !== null && data.dueDate > rental.endDate)
    ) {
      return NextResponse.json(
        { error: 'Дата платежа выходит за пределы периода аренды' },
        { status: 400 },
      );
    }

    const paidAt = data.paid ? new Date().toISOString() : null;
    const updateSet: { paidAt: string | null; amount?: number } = { paidAt };
    if (data.amount !== undefined) {
      updateSet.amount = data.amount;
    }

    const [payment] = await db
      .insert(rentalPayments)
      .values({
        rentalId: rental.id,
        dueDate: data.dueDate,
        amount: data.amount ?? rental.rateAmount,
        paidAt,
      })
      .onConflictDoUpdate({
        target: [rentalPayments.rentalId, rentalPayments.dueDate],
        set: updateSet,
      })
      .returning();

    return NextResponse.json({ payment });
  } catch (err) {
    return handleApiError(err);
  }
}
