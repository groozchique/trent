import { NextResponse } from 'next/server';
import { db } from '@/db';
import { drivers } from '@/db/schema';
import { requireAdmin, requireAuth } from '@/lib/auth/session';
import { handleApiError } from '@/lib/cars';
import { buildEmptyDriverSummary, listDriverSummaries } from '@/lib/drivers';
import { createDriverSchema, parseJsonBody } from '@/lib/validation';

export async function GET() {
  try {
    await requireAuth();
    const list = await listDriverSummaries(db);
    return NextResponse.json({ drivers: list });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const data = await parseJsonBody(request, createDriverSchema);
    const [created] = await db
      .insert(drivers)
      .values({
        fullName: data.fullName,
        phone: data.phone,
        notes: data.notes,
      })
      .returning();

    return NextResponse.json({ driver: buildEmptyDriverSummary(created) }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
