import { eq, inArray } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { fines } from '@/db/schema';
import { resolveFineDriverId } from './attribution';
import { getFinesProvider, type FinesProvider } from './provider';

export type SyncCarFinesOptions =
  | FinesProvider
  | {
      stsNumber?: string | null;
      provider?: FinesProvider;
    };

function isFinesProvider(options: SyncCarFinesOptions | undefined): options is FinesProvider {
  return options !== undefined && typeof (options as FinesProvider).fetchFinesByPlate === 'function';
}

/** Fetch fines for a plate (with optional STS), attribute driver from rental history, and upsert idempotently. */
export async function syncCarFines(
  database: AppDb,
  carId: number,
  plate: string,
  options?: SyncCarFinesOptions,
): Promise<{ inserted: number; updated: number }> {
  const provider = isFinesProvider(options) ? options : (options?.provider ?? getFinesProvider());
  const stsNumber = isFinesProvider(options) ? undefined : options?.stsNumber;
  const fetched = await provider.fetchFinesByPlate(plate, stsNumber);
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
        driverId: fines.driverId,
        resolutionNumber: fines.resolutionNumber,
        status: fines.status,
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
        const preservedStatus =
          existingRow.status === 'paid' && fine.status === 'unpaid' ? 'paid' : fine.status;
        const driverPatch =
          existingRow.driverId === null
            ? { driverId: resolveFineDriverId(tx, carId, fine.violatedAt) }
            : {};
        tx.update(fines)
          .set({ ...mutableFields, status: preservedStatus, ...driverPatch })
          .where(eq(fines.id, existingRow.id))
          .run();
        updated += 1;
      } else {
        tx.insert(fines)
          .values({
            carId,
            driverId: resolveFineDriverId(tx, carId, fine.violatedAt),
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
