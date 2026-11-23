import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireAuth } from '@/lib/auth/session';
import { handleApiError } from '@/lib/cars';
import { buildReport, getCalendarMonthRange, getIsoWeekRange } from '@/lib/reports';
import { reportQuerySchema } from '@/lib/validation';

export async function GET(request: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const parsed = reportQuerySchema.parse({
      type: searchParams.get('type') ?? 'weekly',
      date: searchParams.get('date') ?? undefined,
      month: searchParams.get('month') ?? undefined,
      carId: searchParams.get('carId') ?? undefined,
      includeMaintenance: searchParams.get('includeMaintenance') ?? undefined,
    });

    const { start, end } =
      parsed.type === 'weekly'
        ? getIsoWeekRange(parsed.date!)
        : getCalendarMonthRange(parsed.month!);

    const report = await buildReport(db, {
      type: parsed.type,
      periodStart: start,
      periodEnd: end,
      carId: parsed.carId,
      includeMaintenance: parsed.includeMaintenance,
    });

    return NextResponse.json({ report });
  } catch (err) {
    return handleApiError(err);
  }
}
