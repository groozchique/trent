import { NextResponse } from 'next/server';
import { and, eq, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { carDocuments, cars } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/session';
import { evaluateCarDeadlines } from '@/lib/deadlines';
import {
  getTodayIso,
  handleApiError,
  parseCarIdParam,
  toCarDocumentDtos,
  type RouteIdContext,
} from '@/lib/cars';
import { parseJsonBody, upsertDocumentsSchema } from '@/lib/validation';

export async function PUT(request: Request, context: RouteIdContext) {
  try {
    await requireAdmin();
    const carId = await parseCarIdParam(context);
    const data = await parseJsonBody(request, upsertDocumentsSchema);
    const todayIso = getTodayIso();

    const result = db.transaction((tx) => {
      const car = tx
        .select({ id: cars.id, mileage: cars.mileage })
        .from(cars)
        .where(eq(cars.id, carId))
        .get();
      if (!car) return null;

      tx.update(cars)
        .set({
          nextServiceMileage: data.nextServiceMileage,
          nextServiceDate: data.nextServiceDate,
        })
        .where(eq(cars.id, carId))
        .run();

      if (data.documents.length === 0) {
        tx.delete(carDocuments).where(eq(carDocuments.carId, carId)).run();
      } else {
        const keepTypes = data.documents.map((doc) => doc.type);
        tx.delete(carDocuments)
          .where(and(eq(carDocuments.carId, carId), notInArray(carDocuments.type, keepTypes)))
          .run();

        for (const doc of data.documents) {
          tx.insert(carDocuments)
            .values({
              carId,
              type: doc.type,
              expiresAt: doc.expiresAt,
              policyNumber: doc.policyNumber,
              notes: doc.notes,
            })
            .onConflictDoUpdate({
              target: [carDocuments.carId, carDocuments.type],
              set: {
                expiresAt: doc.expiresAt,
                policyNumber: doc.policyNumber,
                notes: doc.notes,
              },
            })
            .run();
        }
      }

      const docRows = tx.select().from(carDocuments).where(eq(carDocuments.carId, carId)).all();
      const documents = toCarDocumentDtos(docRows, todayIso);
      const deadlines = evaluateCarDeadlines(
        {
          mileage: car.mileage,
          nextServiceMileage: data.nextServiceMileage,
          nextServiceDate: data.nextServiceDate,
        },
        docRows,
        todayIso,
      );

      return {
        documents,
        deadlines,
        nextServiceMileage: data.nextServiceMileage,
        nextServiceDate: data.nextServiceDate,
      };
    });

    if (!result) {
      return NextResponse.json({ error: 'Автомобиль не найден' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
