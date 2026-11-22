import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { drivers, fines } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import { handleApiError, requirePositiveIntParam } from '@/lib/cars';
import { parseJsonBody, updateFineStatusSchema, type FineDto } from '@/lib/validation';

type FineRouteContext = { params: Promise<{ id: string; fineId: string }> };

export async function PATCH(request: Request, context: FineRouteContext) {
  try {
    await requireAdmin();
    const { id, fineId: rawFineId } = await context.params;
    const carId = requirePositiveIntParam(id, 'Некорректный идентификатор автомобиля');
    const fineId = requirePositiveIntParam(rawFineId, 'Некорректный идентификатор штрафа');
    const data = await parseJsonBody(request, updateFineStatusSchema);

    const fine: FineDto | null = db.transaction((tx) => {
      const updated = tx
        .update(fines)
        .set({ status: data.status })
        .where(and(eq(fines.id, fineId), eq(fines.carId, carId)))
        .returning()
        .get();
      if (!updated) return null;

      const driver =
        updated.driverId !== null
          ? tx
              .select({ fullName: drivers.fullName })
              .from(drivers)
              .where(eq(drivers.id, updated.driverId))
              .get()
          : undefined;

      return { ...updated, driverName: driver?.fullName ?? null };
    });

    if (!fine) {
      return NextResponse.json({ error: 'Штраф не найден' }, { status: 404 });
    }

    return NextResponse.json({ fine });
  } catch (err) {
    return handleApiError(err);
  }
}
