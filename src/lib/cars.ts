import { NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { AppDb } from '@/db';
import {
  CAR_DOCUMENT_TYPES,
  carDocuments,
  cars,
  drivers,
  fines,
  maintenanceParts,
  maintenanceRecords,
  rentalPayments,
  rentals,
  users,
  type CarDocumentRow,
  type CarDocumentType,
  type CarRow,
} from '@/db/schema';
import { AuthError } from '@/lib/auth/session';
import { evaluateCarDeadlines, evaluateDateDeadline } from '@/lib/deadlines';
import {
  computeFleetFinancialSummary,
  computeRentDebt30d,
  groupPaymentsByRental,
} from '@/lib/finances';
import type { SQLiteTx } from '@/lib/fines/attribution';
import { buildRentalTimeline } from '@/lib/rental/timeline';
import { formatUserLabel } from '@/lib/users';
import {
  ApiError,
  parsePositiveIntId,
  type CarDetailDto,
  type CarDocumentDto,
  type CarSummaryDto,
  type FineDto,
  type FleetDashboardSummary,
  type MaintenancePartDto,
  type RentalDto,
  type RentalHistoryItemDto,
} from '@/lib/validation';

export { ApiError };
export type RouteIdContext = { params: Promise<{ id: string }> };

const DOCUMENT_TYPE_ORDER = new Map<CarDocumentType, number>(
  CAR_DOCUMENT_TYPES.map((docType, index) => [docType, index]),
);

/** Return current UTC calendar date as `YYYY-MM-DD`. */
export function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Validate a route param as a strictly positive integer or throw Russian ApiError(400). */
export function requirePositiveIntParam(raw: string, errorMessage: string): number {
  const parsed = parsePositiveIntId(raw);
  if (parsed === null) {
    throw new ApiError(400, errorMessage);
  }
  return parsed;
}

/** Extract and validate `[id]` route parameter as a positive integer. */
export async function parseCarIdParam(context: RouteIdContext): Promise<number> {
  const { id } = await context.params;
  return requirePositiveIntParam(id, 'Некорректный идентификатор автомобиля');
}

function getUniqueConstraintMessage(err: unknown): string | null {
  const record = err as
    | { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } }
    | null;
  const code = record?.code ?? record?.cause?.code;
  const message = `${String(record?.message ?? '')} ${String(record?.cause?.message ?? '')}`;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || message.includes('UNIQUE constraint failed')) {
    if (message.includes('cars.plate')) {
      return 'Автомобиль с таким гос. номером уже существует';
    }
    if (message.includes('fines.resolution_number')) {
      return 'Штраф с таким номером постановления уже существует';
    }
    if (message.includes('users.username')) {
      return 'Пользователь с таким логином уже существует';
    }
    return 'Запись с такими данными уже существует';
  }
  return null;
}

/** Map AuthError, ApiError, ZodError, and SQLite conflicts to Russian JSON responses. */
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
  const uniqueMessage = getUniqueConstraintMessage(err);
  if (uniqueMessage !== null) {
    return NextResponse.json({ error: uniqueMessage }, { status: 409 });
  }
  return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
}

/** Map raw `car_documents` rows into `CarDocumentDto[]` sorted consistently by document type. */
export function toCarDocumentDtos(
  docs: ReadonlyArray<CarDocumentRow>,
  todayIso: string,
): CarDocumentDto[] {
  return [...docs]
    .sort((a, b) => (DOCUMENT_TYPE_ORDER.get(a.type) ?? 99) - (DOCUMENT_TYPE_ORDER.get(b.type) ?? 99))
    .map((doc) => ({
      id: doc.id,
      carId: doc.carId,
      type: doc.type,
      expiresAt: doc.expiresAt,
      policyNumber: doc.policyNumber,
      notes: doc.notes,
      ...evaluateDateDeadline(doc.expiresAt, todayIso),
    }));
}

/** Compute maintenance total cost from labor cost and parts list. */
export function computeMaintenanceTotal(
  laborCost: number,
  parts: ReadonlyArray<{ quantity: number; unitPrice: number }>,
): number {
  return laborCost + parts.reduce((sum, part) => sum + part.quantity * part.unitPrice, 0);
}

/** Insert parts rows for a maintenance record inside an active transaction. */
export function insertMaintenanceParts(
  tx: SQLiteTx,
  recordId: number,
  parts: ReadonlyArray<{ name: string; sku: string | null; quantity: number; unitPrice: number }>,
): MaintenancePartDto[] {
  if (parts.length === 0) return [];
  return tx
    .insert(maintenanceParts)
    .values(
      parts.map((part) => ({
        recordId,
        name: part.name,
        sku: part.sku,
        quantity: part.quantity,
        unitPrice: part.unitPrice,
      })),
    )
    .returning()
    .all();
}

/** Resolve an active driver by `driverId` or find/create one by `renterName` inside a transaction. */
export function resolveOrCreateDriverForRental(
  tx: SQLiteTx,
  input: { driverId?: number | null; renterName?: string },
): { id: number; fullName: string; phone: string | null } {
  if (input.driverId !== undefined && input.driverId !== null) {
    const driver = tx
      .select({
        id: drivers.id,
        fullName: drivers.fullName,
        phone: drivers.phone,
        archived: drivers.archived,
      })
      .from(drivers)
      .where(eq(drivers.id, input.driverId))
      .get();
    if (!driver) {
      throw new ApiError(404, 'Водитель не найден');
    }
    if (driver.archived) {
      throw new ApiError(400, 'Нельзя назначить архивного водителя в аренду');
    }
    return { id: driver.id, fullName: driver.fullName, phone: driver.phone };
  }

  const trimmedName = input.renterName?.trim() ?? '';
  const key = trimmedName.toLowerCase();
  const activeDrivers = tx
    .select({ id: drivers.id, fullName: drivers.fullName, phone: drivers.phone })
    .from(drivers)
    .where(eq(drivers.archived, false))
    .orderBy(asc(drivers.id))
    .all();

  const existing = activeDrivers.find((driver) => driver.fullName.trim().toLowerCase() === key);
  if (existing) return existing;

  return tx
    .insert(drivers)
    .values({ fullName: trimmedName })
    .returning({ id: drivers.id, fullName: drivers.fullName, phone: drivers.phone })
    .get();
}

/** Build an initial `CarSummaryDto` for a freshly inserted car row. */
export function buildEmptyCarSummary(car: CarRow): CarSummaryDto {
  return {
    id: car.id,
    plate: car.plate,
    brand: car.brand,
    model: car.model,
    status: car.status,
    mileage: car.mileage,
    stsNumber: car.stsNumber,
    nextServiceMileage: car.nextServiceMileage,
    nextServiceDate: car.nextServiceDate,
    ownerId: car.ownerId ?? null,
    ownerName: null,
    unpaidFinesCount: 0,
    unpaidFinesSum: 0,
    rentDebt30d: 0,
    activeDriverId: null,
    activeDriverName: null,
    deadlineStatus: 'ok',
    urgentDeadlinesCount: 0,
  };
}

function resolveOwnerName(
  ownerId: number | null,
  ownerUsername: string | null,
  ownerDisplayName: string | null,
): string | null {
  if (ownerId === null || !ownerUsername) return null;
  return formatUserLabel({ username: ownerUsername, displayName: ownerDisplayName });
}

async function queryCarSummaryInputs(
  database: AppDb,
  options?: { carId?: number; ownerId?: number },
) {
  const conditions = [];
  if (options?.carId !== undefined) conditions.push(eq(cars.id, options.carId));
  if (options?.ownerId !== undefined) conditions.push(eq(cars.ownerId, options.ownerId));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const isScoped = options?.carId !== undefined || options?.ownerId !== undefined;

  const carBase = database
    .select({
      car: cars,
      ownerUsername: users.username,
      ownerDisplayName: users.displayName,
    })
    .from(cars)
    .leftJoin(users, eq(cars.ownerId, users.id));

  const carRows = await (whereClause ? carBase.where(whereClause) : carBase).orderBy(asc(cars.id));

  if (carRows.length === 0) {
    return {
      carRows,
      rentalRows: [],
      paymentRows: [],
      fineRows: [],
      docRows: [],
    };
  }

  const carIds = carRows.map((row) => row.car.id);

  const rentalBase = database
    .select({
      rental: rentals,
      driverFullName: drivers.fullName,
    })
    .from(rentals)
    .leftJoin(drivers, eq(rentals.driverId, drivers.id));

  const rentalRows = await (isScoped
    ? rentalBase.where(inArray(rentals.carId, carIds))
    : rentalBase
  ).orderBy(desc(rentals.startDate), desc(rentals.id));

  const rentalIds = rentalRows.map((row) => row.rental.id);
  const paymentRows = isScoped
    ? rentalIds.length > 0
      ? await database
          .select({
            rentalId: rentalPayments.rentalId,
            dueDate: rentalPayments.dueDate,
            amount: rentalPayments.amount,
            paidAt: rentalPayments.paidAt,
          })
          .from(rentalPayments)
          .where(inArray(rentalPayments.rentalId, rentalIds))
      : []
    : await database
        .select({
          rentalId: rentalPayments.rentalId,
          dueDate: rentalPayments.dueDate,
          amount: rentalPayments.amount,
          paidAt: rentalPayments.paidAt,
        })
        .from(rentalPayments);

  const fineBase = database
    .select({
      carId: fines.carId,
      amount: fines.amount,
      status: fines.status,
    })
    .from(fines);
  const fineRows = await (isScoped ? fineBase.where(inArray(fines.carId, carIds)) : fineBase);

  const docBase = database
    .select({
      carId: carDocuments.carId,
      type: carDocuments.type,
      expiresAt: carDocuments.expiresAt,
    })
    .from(carDocuments);
  const docRows = await (isScoped
    ? docBase.where(inArray(carDocuments.carId, carIds))
    : docBase);

  return { carRows, rentalRows, paymentRows, fineRows, docRows };
}

function buildCarSummaries(
  inputs: Awaited<ReturnType<typeof queryCarSummaryInputs>>,
  todayIso: string,
): CarSummaryDto[] {
  const rentalsByCar = new Map<number, typeof inputs.rentalRows>();
  for (const item of inputs.rentalRows) {
    const list = rentalsByCar.get(item.rental.carId);
    if (list) list.push(item);
    else rentalsByCar.set(item.rental.carId, [item]);
  }

  const paymentsByRental = groupPaymentsByRental(inputs.paymentRows);

  const unpaidFinesByCar = new Map<number, { count: number; sum: number }>();
  for (const fine of inputs.fineRows) {
    if (fine.status !== 'unpaid') continue;
    const prev = unpaidFinesByCar.get(fine.carId);
    if (prev) {
      prev.count += 1;
      prev.sum += fine.amount;
    } else {
      unpaidFinesByCar.set(fine.carId, { count: 1, sum: fine.amount });
    }
  }

  const docsByCar = new Map<number, Array<Pick<CarDocumentRow, 'type' | 'expiresAt'>>>();
  for (const doc of inputs.docRows) {
    const list = docsByCar.get(doc.carId);
    if (list) list.push(doc);
    else docsByCar.set(doc.carId, [doc]);
  }

  return inputs.carRows.map(({ car, ownerUsername, ownerDisplayName }) => {
    const carRentals = rentalsByCar.get(car.id) ?? [];
    const activeRental = carRentals.find((r) => r.rental.active);
    const fineStats = unpaidFinesByCar.get(car.id);
    const deadlines = evaluateCarDeadlines(car, docsByCar.get(car.id) ?? [], todayIso);

    return {
      id: car.id,
      plate: car.plate,
      brand: car.brand,
      model: car.model,
      status: car.status,
      mileage: car.mileage,
      stsNumber: car.stsNumber,
      nextServiceMileage: car.nextServiceMileage,
      nextServiceDate: car.nextServiceDate,
      ownerId: car.ownerId ?? null,
      ownerName: resolveOwnerName(car.ownerId ?? null, ownerUsername, ownerDisplayName),
      unpaidFinesCount: fineStats?.count ?? 0,
      unpaidFinesSum: fineStats?.sum ?? 0,
      rentDebt30d: computeRentDebt30d(
        carRentals.map((r) => r.rental),
        paymentsByRental,
        todayIso,
      ),
      activeDriverId: activeRental ? activeRental.rental.driverId : null,
      activeDriverName: activeRental
        ? (activeRental.driverFullName ?? activeRental.rental.renterName)
        : null,
      deadlineStatus: deadlines.status,
      urgentDeadlinesCount: deadlines.urgentDeadlinesCount,
    };
  });
}

/** Return fleet cars (optionally scoped by ownerId) with v2 summary metrics and 30-day KPI totals. */
export async function listCarSummariesWithSummary(
  database: AppDb,
  todayIso = getTodayIso(),
  options?: { ownerId?: number },
): Promise<{ cars: CarSummaryDto[]; summary: FleetDashboardSummary }> {
  const inputs = await queryCarSummaryInputs(
    database,
    options?.ownerId !== undefined ? { ownerId: options.ownerId } : undefined,
  );
  const carIds = inputs.carRows.map((row) => row.car.id);
  const maintBase = database
    .select({
      performedAt: maintenanceRecords.performedAt,
      totalCost: maintenanceRecords.totalCost,
    })
    .from(maintenanceRecords);
  const maintRows =
    carIds.length === 0
      ? []
      : await (options?.ownerId !== undefined
          ? maintBase.where(inArray(maintenanceRecords.carId, carIds))
          : maintBase);

  const carSummaries = buildCarSummaries(inputs, todayIso);
  const summary = computeFleetFinancialSummary(
    carSummaries,
    inputs.rentalRows.map((r) => r.rental),
    inputs.paymentRows,
    maintRows,
    todayIso,
    {
      fines: inputs.fineRows,
      urgentDeadlineCarsCount: carSummaries.filter((car) => car.deadlineStatus !== 'ok').length,
    },
  );

  return { cars: carSummaries, summary };
}

/** Return fleet-wide 30-day financial KPIs and urgent deadline car count. */
export async function getFleetSummary(
  database: AppDb,
  todayIso = getTodayIso(),
): Promise<FleetDashboardSummary> {
  const { summary } = await listCarSummariesWithSummary(database, todayIso);
  return summary;
}

/** Return all fleet cars with v2 summary metrics for dashboard and SSR pages. */
export async function listCarSummaries(
  database: AppDb,
  todayIso = getTodayIso(),
): Promise<CarSummaryDto[]> {
  const inputs = await queryCarSummaryInputs(database);
  return buildCarSummaries(inputs, todayIso);
}

/** Return a single car summary or null if not found. */
export async function getCarSummary(
  database: AppDb,
  carId: number,
  todayIso = getTodayIso(),
): Promise<CarSummaryDto | null> {
  const inputs = await queryCarSummaryInputs(database, { carId });
  const [row] = buildCarSummaries(inputs, todayIso);
  return row ?? null;
}

/** Load full v2 car details including documents, deadlines, rental history, fines with driver names, and maintenance. */
export async function getCarDetail(
  database: AppDb,
  carId: number,
  todayIso = getTodayIso(),
): Promise<CarDetailDto | null> {
  const [carRow] = await database
    .select({
      car: cars,
      ownerUsername: users.username,
      ownerDisplayName: users.displayName,
    })
    .from(cars)
    .leftJoin(users, eq(cars.ownerId, users.id))
    .where(eq(cars.id, carId))
    .limit(1);
  if (!carRow) return null;
  const { car, ownerUsername, ownerDisplayName } = carRow;

  const [fineRows, rentalRows, docRows, maintRows] = await Promise.all([
    database
      .select({
        fine: fines,
        driverFullName: drivers.fullName,
      })
      .from(fines)
      .leftJoin(drivers, eq(fines.driverId, drivers.id))
      .where(eq(fines.carId, carId))
      .orderBy(desc(fines.violatedAt), desc(fines.id)),
    database
      .select({
        rental: rentals,
        driverFullName: drivers.fullName,
        driverPhone: drivers.phone,
      })
      .from(rentals)
      .leftJoin(drivers, eq(rentals.driverId, drivers.id))
      .where(eq(rentals.carId, carId))
      .orderBy(desc(rentals.startDate), desc(rentals.id)),
    database.select().from(carDocuments).where(eq(carDocuments.carId, carId)),
    database
      .select()
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.carId, carId))
      .orderBy(desc(maintenanceRecords.performedAt), desc(maintenanceRecords.id)),
  ]);

  const rentalIds = rentalRows.map((row) => row.rental.id);
  const paymentRows =
    rentalIds.length > 0
      ? await database
          .select()
          .from(rentalPayments)
          .where(inArray(rentalPayments.rentalId, rentalIds))
      : [];
  const paymentsByRental = groupPaymentsByRental(paymentRows);

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
    if (list) list.push(part);
    else partsByRecord.set(part.recordId, [part]);
  }

  const carFines: FineDto[] = fineRows.map(({ fine, driverFullName }) => ({
    id: fine.id,
    carId: fine.carId,
    driverId: fine.driverId,
    driverName: driverFullName ?? null,
    resolutionNumber: fine.resolutionNumber,
    violatedAt: fine.violatedAt,
    amount: fine.amount,
    discountAmount: fine.discountAmount,
    discountDeadline: fine.discountDeadline,
    paymentDeadline: fine.paymentDeadline,
    description: fine.description,
    status: fine.status,
  }));

  const activeRentalRow = rentalRows.find((r) => r.rental.active) ?? null;
  const activeRental: RentalDto | null = activeRentalRow
    ? {
        id: activeRentalRow.rental.id,
        carId: activeRentalRow.rental.carId,
        driverId: activeRentalRow.rental.driverId,
        renterName: activeRentalRow.driverFullName ?? activeRentalRow.rental.renterName,
        driverPhone: activeRentalRow.driverPhone ?? null,
        rateAmount: activeRentalRow.rental.rateAmount,
        periodicity: activeRentalRow.rental.periodicity,
        startDate: activeRentalRow.rental.startDate,
        endDate: activeRentalRow.rental.endDate,
        active: activeRentalRow.rental.active,
        managerCommissionPercent: activeRentalRow.rental.managerCommissionPercent,
      }
    : null;

  const rentalHistory: RentalHistoryItemDto[] = rentalRows.map(
    ({ rental, driverFullName, driverPhone }) => ({
      id: rental.id,
      carId: rental.carId,
      driverId: rental.driverId,
      renterName: driverFullName ?? rental.renterName,
      driverPhone: driverPhone ?? null,
      rateAmount: rental.rateAmount,
      periodicity: rental.periodicity,
      startDate: rental.startDate,
      endDate: rental.endDate,
      active: rental.active,
      managerCommissionPercent: rental.managerCommissionPercent,
      rentDebt30d: computeRentDebt30d([rental], paymentsByRental, todayIso),
    }),
  );

  const rentDebt30d = computeRentDebt30d(
    rentalRows.map((row) => row.rental),
    paymentsByRental,
    todayIso,
  );

  const activePayments = activeRentalRow
    ? (paymentsByRental.get(activeRentalRow.rental.id) ?? [])
    : [];
  const timeline = buildRentalTimeline(
    activeRentalRow ? activeRentalRow.rental : null,
    activePayments,
    todayIso,
  );

  const documents = toCarDocumentDtos(docRows, todayIso);
  const deadlines = evaluateCarDeadlines(car, docRows, todayIso);

  let unpaidFinesCount = 0;
  let unpaidFinesSum = 0;
  for (const fine of carFines) {
    if (fine.status === 'unpaid') {
      unpaidFinesCount += 1;
      unpaidFinesSum += fine.amount;
    }
  }

  return {
    id: car.id,
    plate: car.plate,
    brand: car.brand,
    model: car.model,
    status: car.status,
    mileage: car.mileage,
    stsNumber: car.stsNumber,
    nextServiceMileage: car.nextServiceMileage,
    nextServiceDate: car.nextServiceDate,
    ownerId: car.ownerId ?? null,
    ownerName: resolveOwnerName(car.ownerId ?? null, ownerUsername, ownerDisplayName),
    unpaidFinesCount,
    unpaidFinesSum,
    rentDebt30d,
    activeDriverId: activeRental?.driverId ?? null,
    activeDriverName: activeRental?.renterName ?? null,
    deadlineStatus: deadlines.status,
    urgentDeadlinesCount: deadlines.urgentDeadlinesCount,
    documents,
    deadlines,
    fines: carFines,
    rental: activeRental,
    rentalHistory,
    timeline,
    maintenance: maintRows.map((record) => ({
      ...record,
      parts: partsByRecord.get(record.id) ?? [],
    })),
  };
}
