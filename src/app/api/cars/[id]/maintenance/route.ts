import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, maintenanceParts, maintenanceRecords } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import { handleApiError, parseCarIdParam, type RouteIdContext } from '@/lib/cars';
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

      const partsSum = data.parts.reduce((sum, part) => sum + part.quantity * part.unitPrice, 0);
      const totalCost = data.laborCost + partsSum;

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

      const insertedParts =
        data.parts.length > 0
          ? tx
              .insert(maintenanceParts)
              .values(
                data.parts.map((part) => ({
                  recordId: insertedRecord.id,
                  name: part.name,
                  sku: part.sku,
                  quantity: part.quantity,
                  unitPrice: part.unitPrice,
                })),
              )
              .returning()
              .all()
          : [];

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
