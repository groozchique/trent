import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, maintenanceRecords } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import {
  computeMaintenanceTotal,
  handleApiError,
  insertMaintenanceParts,
  parseCarIdParam,
  type RouteIdContext,
} from '@/lib/cars';
import {
  createMaintenanceSchema,
  parseJsonBody,
  type MaintenanceDto,
} from '@/lib/validation';

export async function POST(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, createMaintenanceSchema);

    const record: MaintenanceDto | null = db.transaction((tx) => {
      const car = tx
        .select({ id: cars.id, mileage: cars.mileage })
        .from(cars)
        .where(eq(cars.id, carId))
        .get();
      if (!car) return null;

      const totalCost = computeMaintenanceTotal(data.laborCost, data.parts);
      const insertedRecord = tx
        .insert(maintenanceRecords)
        .values({
          carId,
          title: data.title,
          performedAt: data.performedAt,
          mileage: data.mileage,
          laborCost: data.laborCost,
          totalCost,
          notes: data.notes,
        })
        .returning()
        .get();

      const insertedParts = insertMaintenanceParts(tx, insertedRecord.id, data.parts);

      if (data.mileage > car.mileage) {
        tx.update(cars).set({ mileage: data.mileage }).where(eq(cars.id, carId)).run();
      }

      return { ...insertedRecord, parts: insertedParts };
    });

    if (!record) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }

    return NextResponse.json({ record }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
