import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { cars, maintenanceParts, maintenanceRecords } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import {
  ApiError,
  computeMaintenanceTotal,
  handleApiError,
  insertMaintenanceParts,
  requirePositiveIntParam,
} from '@/lib/cars';
import {
  createMaintenanceSchema,
  parseJsonBody,
  type MaintenanceDto,
} from '@/lib/validation';

type MaintenanceRouteContext = { params: Promise<{ id: string; recordId: string }> };

export async function PATCH(request: Request, context: MaintenanceRouteContext) {
  try {
    await requireAdmin();
    const { id, recordId: rawRecordId } = await context.params;
    const carId = requirePositiveIntParam(id, 'Некорректный идентификатор автомобиля');
    const recordId = requirePositiveIntParam(rawRecordId, 'Некорректный идентификатор записи ТО');
    const data = await parseJsonBody(request, createMaintenanceSchema);

    const record: MaintenanceDto = db.transaction((tx) => {
      const car = tx
        .select({ id: cars.id, mileage: cars.mileage })
        .from(cars)
        .where(eq(cars.id, carId))
        .get();
      if (!car) {
        throw new ApiError(404, 'Автомобиль не найден');
      }

      const existing = tx
        .select({ id: maintenanceRecords.id })
        .from(maintenanceRecords)
        .where(and(eq(maintenanceRecords.id, recordId), eq(maintenanceRecords.carId, carId)))
        .get();
      if (!existing) {
        throw new ApiError(404, 'Запись ТО не найдена');
      }

      const totalCost = computeMaintenanceTotal(data.laborCost, data.parts);
      const updatedRecord = tx
        .update(maintenanceRecords)
        .set({
          title: data.title,
          performedAt: data.performedAt,
          mileage: data.mileage,
          laborCost: data.laborCost,
          totalCost,
          notes: data.notes,
        })
        .where(and(eq(maintenanceRecords.id, recordId), eq(maintenanceRecords.carId, carId)))
        .returning()
        .get();

      tx.delete(maintenanceParts).where(eq(maintenanceParts.recordId, recordId)).run();
      const insertedParts = insertMaintenanceParts(tx, recordId, data.parts);

      if (data.mileage > car.mileage) {
        tx.update(cars).set({ mileage: data.mileage }).where(eq(cars.id, carId)).run();
      }

      return { ...updatedRecord, parts: insertedParts };
    });

    return NextResponse.json({ record });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_request: Request, context: MaintenanceRouteContext) {
  try {
    await requireAdmin();
    const { id, recordId: rawRecordId } = await context.params;
    const carId = requirePositiveIntParam(id, 'Некорректный идентификатор автомобиля');
    const recordId = requirePositiveIntParam(rawRecordId, 'Некорректный идентификатор записи ТО');

    db.transaction((tx) => {
      const car = tx.select({ id: cars.id }).from(cars).where(eq(cars.id, carId)).get();
      if (!car) {
        throw new ApiError(404, 'Автомобиль не найден');
      }

      const deleted = tx
        .delete(maintenanceRecords)
        .where(and(eq(maintenanceRecords.id, recordId), eq(maintenanceRecords.carId, carId)))
        .returning({ id: maintenanceRecords.id })
        .get();
      if (!deleted) {
        throw new ApiError(404, 'Запись ТО не найдена');
      }
    });

    return NextResponse.json({ ok: true, deletedId: recordId });
  } catch (err) {
    return handleApiError(err);
  }
}
