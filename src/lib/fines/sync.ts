import { eq, inArray } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { fines } from '@/db/schema';
import { getFinesProvider, type FinesProvider } from './provider';

/** Fetch fines for a plate and upsert them idempotently by resolutionNumber. */
export async function syncCarFines(
  database: AppDb,
  carId: number,
  plate: string,
  provider: FinesProvider = getFinesProvider(),
): Promise<{ inserted: number; updated: number }> {
  const fetched = await provider.fetchFinesByPlate(plate);
  if (fetched.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const byResolution = new Map(fetched.map((fine) => [fine.resolutionNumber, fine]));
  const resolutionNumbers = [...byResolution.keys()];

  return database.transaction((tx) => {
    const existing = tx
      .select({
        id: fines.id,
        carId: fines.carId,
        resolutionNumber: fines.resolutionNumber,
      })
      .from(fines)
      .where(inArray(fines.resolutionNumber, resolutionNumbers))
      .all();

    const existingByRes = new Map(existing.map((row) => [row.resolutionNumber, row]));

    let inserted = 0;
    let updated = 0;

    for (const fine of byResolution.values()) {
      const mutableFields = {
        violatedAt: fine.violatedAt,
        amount: fine.amount,
        discountAmount: fine.discountAmount,
        discountDeadline: fine.discountDeadline,
        paymentDeadline: fine.paymentDeadline,
        description: fine.description,
        status: fine.status,
      };

      const existingRow = existingByRes.get(fine.resolutionNumber);
      if (existingRow !== undefined) {
        if (existingRow.carId !== carId) continue;
        tx.update(fines).set(mutableFields).where(eq(fines.id, existingRow.id)).run();
        updated += 1;
      } else {
        tx.insert(fines)
          .values({
            carId,
            resolutionNumber: fine.resolutionNumber,
            ...mutableFields,
          })
          .run();
        inserted += 1;
      }
    }

    return { inserted, updated };
  });
}
