import { NextResponse } from 'next/server';
import { db } from '@/db';
import { cars } from '@/db/schema';
import { requireAdmin, requireAuth } from '@/lib/auth/session';
import {
  buildEmptyCarSummary,
  handleApiError,
  listCarSummariesWithSummary,
} from '@/lib/cars';
import { createCarSchema, parseJsonBody } from '@/lib/validation';

export async function GET() {
  try {
    await requireAuth();
    const result = await listCarSummariesWithSummary(db);
    return NextResponse.json(result);
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
      .values({ ...data, stsNumber: data.stsNumber ?? null })
      .returning();

    return NextResponse.json({ car: buildEmptyCarSummary(created) }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
