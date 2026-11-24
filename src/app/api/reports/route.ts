import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireStaff } from '@/lib/auth/session';
import { handleApiError } from '@/lib/cars';
import {
  buildReport,
  getCalendarMonthRange,
  getCalendarYearRange,
  getIsoWeekRange,
} from '@/lib/reports';
import { reportQuerySchema } from '@/lib/validation';

export async function GET(request: Request) {
  try {
    await requireStaff();
    const { searchParams } = new URL(request.url);

    const parsed = reportQuerySchema.parse({
      type: searchParams.get('type') ?? 'weekly',
      date: searchParams.get('date') ?? undefined,
      month: searchParams.get('month') ?? undefined,
      year: searchParams.get('year') ?? undefined,
      carId: searchParams.get('carId') ?? undefined,
      ownerId: searchParams.get('ownerId') ?? undefined,
      includeFinancial: searchParams.get('includeFinancial') ?? undefined,
      includeMaintenance: searchParams.get('includeMaintenance') ?? undefined,
    });

    const { start, end } =
      parsed.type === 'weekly'
        ? getIsoWeekRange(parsed.date!)
        : parsed.type === 'monthly'
          ? getCalendarMonthRange(parsed.month!)
          : getCalendarYearRange(parsed.year!);

    const report = await buildReport(db, {
      type: parsed.type,
      periodStart: start,
      periodEnd: end,
      carId: parsed.carId,
      ownerId: parsed.ownerId,
      includeFinancial: parsed.includeFinancial,
      includeMaintenance: parsed.includeMaintenance,
    });

    return NextResponse.json({ report });
  } catch (err) {
    return handleApiError(err);
  }
}
