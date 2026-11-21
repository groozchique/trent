import { NextResponse } from 'next/server';
import { db } from '@/db';
import { cars } from '@/db/schema';
import { requireAdmin, requireAuth } from '@/lib/auth/session';
import { handleApiError, listCarSummaries } from '@/lib/cars';
import { createCarSchema, parseJsonBody } from '@/lib/validation';

export async function GET() {
  try {
    await requireAuth();
    const items = await listCarSummaries(db);
    return NextResponse.json({ cars: items });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const data = await parseJsonBody(request, createCarSchema);
    const [created] = await db
      .insert(cars)
      .values(data)
      .returning({
        id: cars.id,
        plate: cars.plate,
        brand: cars.brand,
        model: cars.model,
        status: cars.status,
        mileage: cars.mileage,
      });

    return NextResponse.json({ car: { ...created, unpaidFinesCount: 0 } }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
