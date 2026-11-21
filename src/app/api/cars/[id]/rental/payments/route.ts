import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
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

    const [rental] = await db
      .select({ id: rentals.id, rateAmount: rentals.rateAmount })
      .from(rentals)
      .where(eq(rentals.carId, carId))
      .limit(1);
    if (!rental) {
      return NextResponse.json({ error: 'Аренда для автомобиля не настроена' }, { status: 404 });
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
