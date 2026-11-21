import { NextResponse } from 'next/server';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { AppDb } from '@/db';
import {
  cars,
  fines,
  maintenanceParts,
  maintenanceRecords,
  rentalPayments,
  rentals,
} from '@/db/schema';
import { AuthError } from '@/lib/auth/session';
import { buildRentalTimeline } from '@/lib/rental/timeline';
import {
  parsePositiveIntId,
  type CarDetailDto,
  type CarSummaryDto,
  type MaintenancePartDto,
} from '@/lib/validation';

export type RouteIdContext = { params: Promise<{ id: string }> };

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Extract and validate `[id]` route parameter as a positive integer. */
export async function parseCarIdParam(context: RouteIdContext): Promise<number> {
  const { id } = await context.params;
  const carId = parsePositiveIntId(id);
  if (carId === null) {
    throw new ApiError(400, 'Некорректный идентификатор автомобиля');
  }
  return carId;
}

function getUniqueConstraintMessage(err: unknown): string | null {
  const record = err as
    | { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } }
    | null;
  const code = record?.code ?? record?.cause?.code;
  const message = String(record?.message ?? record?.cause?.message ?? '');
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || message.includes('UNIQUE constraint failed')) {
    if (message.includes('cars.plate')) {
      return 'Автомобиль с таким гос. номером уже существует';
    }
    if (message.includes('fines.resolution_number')) {
      return 'Штраф с таким номером постановления уже существует';
    }
    return 'Запись с такими данными уже существует';
  }
  return null;
}

/** Map AuthError, ZodError, malformed JSON, and SQLite conflicts to Russian JSON responses. */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof AuthError || err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: err.issues[0]?.message ?? 'Некорректные данные' },
      { status: 400 },
    );
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: 'Некорректный формат запроса' }, { status: 400 });
  }
  const uniqueMessage = getUniqueConstraintMessage(err);
  if (uniqueMessage !== null) {
    return NextResponse.json({ error: uniqueMessage }, { status: 409 });
  }
  return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
}

async function queryCarSummaries(database: AppDb, carId?: number): Promise<CarSummaryDto[]> {
  const base = database
    .select({
      id: cars.id,
      plate: cars.plate,
      brand: cars.brand,
      model: cars.model,
      status: cars.status,
      mileage: cars.mileage,
      unpaidFinesCount: sql<number>`coalesce(sum(case when ${fines.status} = 'unpaid' then 1 else 0 end), 0)`,
    })
    .from(cars)
    .leftJoin(fines, eq(fines.carId, cars.id));

  const rows = await (carId !== undefined ? base.where(eq(cars.id, carId)) : base)
    .groupBy(cars.id)
    .orderBy(asc(cars.id));

  return rows.map((row) => ({ ...row, unpaidFinesCount: Number(row.unpaidFinesCount) }));
}

/** Return all fleet cars with unpaid fine counts for dashboard and GET /api/cars. */
export async function listCarSummaries(database: AppDb): Promise<CarSummaryDto[]> {
  return queryCarSummaries(database);
}

/** Return a single car summary or null if not found. */
export async function getCarSummary(database: AppDb, carId: number): Promise<CarSummaryDto | null> {
  const [row] = await queryCarSummaries(database, carId);
  return row ?? null;
}

/** Load full car details including sorted fines, rental timeline, and maintenance with parts. */
export async function getCarDetail(
  database: AppDb,
  carId: number,
  todayIso = new Date().toISOString().slice(0, 10),
): Promise<CarDetailDto | null> {
  const [car] = await database.select().from(cars).where(eq(cars.id, carId)).limit(1);
  if (!car) return null;

  const carFines = await database
    .select()
    .from(fines)
    .where(eq(fines.carId, carId))
    .orderBy(desc(fines.violatedAt), desc(fines.id));

  const [rentalRow] = await database
    .select()
    .from(rentals)
    .where(eq(rentals.carId, carId))
    .limit(1);

  const paymentRows = rentalRow
    ? await database.select().from(rentalPayments).where(eq(rentalPayments.rentalId, rentalRow.id))
    : [];

  const maintRows = await database
    .select()
    .from(maintenanceRecords)
    .where(eq(maintenanceRecords.carId, carId))
    .orderBy(desc(maintenanceRecords.performedAt), desc(maintenanceRecords.id));

  const recordIds = maintRows.map((r) => r.id);
  const partRows =
    recordIds.length > 0
      ? await database
          .select()
          .from(maintenanceParts)
          .where(inArray(maintenanceParts.recordId, recordIds))
          .orderBy(asc(maintenanceParts.id))
      : [];

  const partsByRecord = new Map<number, MaintenancePartDto[]>();
  for (const part of partRows) {
    const list = partsByRecord.get(part.recordId);
    if (list) {
      list.push(part);
    } else {
      partsByRecord.set(part.recordId, [part]);
    }
  }

  return {
    id: car.id,
    plate: car.plate,
    brand: car.brand,
    model: car.model,
    status: car.status,
    mileage: car.mileage,
    unpaidFinesCount: carFines.filter((f) => f.status === 'unpaid').length,
    fines: carFines,
    rental: rentalRow ?? null,
    timeline: buildRentalTimeline(rentalRow?.active ? rentalRow : null, paymentRows, todayIso),
    maintenance: maintRows.map((record) => ({
      ...record,
      parts: partsByRecord.get(record.id) ?? [],
    })),
  };
}
