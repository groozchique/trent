import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { rentals } from '@/db/schema';

export type SQLiteTx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/** Find the driver assigned to `carId` on the violation calendar date (`YYYY-MM-DD`). */
export function resolveFineDriverId(
  database: AppDb | SQLiteTx,
  carId: number,
  violatedAt: string,
): number | null {
  const violatedDate = violatedAt.trim().slice(0, 10);
  if (!violatedDate) return null;

  const row = database
    .select({ driverId: rentals.driverId })
    .from(rentals)
    .where(
      and(
        eq(rentals.carId, carId),
        lte(rentals.startDate, violatedDate),
        or(isNull(rentals.endDate), gte(rentals.endDate, violatedDate)),
      ),
    )
    .orderBy(desc(rentals.startDate), desc(rentals.id))
    .limit(1)
    .get();

  return row?.driverId ?? null;
}
