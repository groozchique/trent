import { asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AppDb } from '@/db';
import {
  cars,
  drivers,
  fines,
  rentalPayments,
  rentals,
  type DriverRow,
  type FineStatus,
  type RentalRow,
} from '@/db/schema';
import { getTodayIso } from '@/lib/cars';
import { computeRentDebt30d, groupPaymentsByRental } from '@/lib/finances';
import { buildRentalTimeline, type TimelinePaymentInput } from '@/lib/rental/timeline';
import type {
  DriverActiveCarDto,
  DriverDetailDto,
  DriverFineDto,
  DriverRentalHistoryDto,
  DriverSummaryDto,
} from '@/lib/validation';

type DriverRentalJoinRow = {
  rental: RentalRow;
  carId: number;
  carPlate: string;
  carBrand: string;
  carModel: string;
};

type DriverFineSummaryInput = {
  driverId: number | null;
  amount: number;
  status: FineStatus;
};

const EMPTY_PAYMENTS: ReadonlyMap<number, TimelinePaymentInput[]> = new Map();

/** Build an initial `DriverSummaryDto` for a freshly inserted driver row. */
export function buildEmptyDriverSummary(driver: DriverRow): DriverSummaryDto {
  return buildDriverSummary(driver, [], EMPTY_PAYMENTS, [], '');
}

function buildDriverSummary(
  driver: DriverRow,
  driverRentals: ReadonlyArray<DriverRentalJoinRow>,
  paymentsByRental: ReadonlyMap<number, TimelinePaymentInput[]>,
  driverFines: ReadonlyArray<DriverFineSummaryInput>,
  todayIso: string,
): DriverSummaryDto {
  const activeCars: DriverActiveCarDto[] = [];
  for (const { rental, carId, carPlate, carBrand, carModel } of driverRentals) {
    if (!rental.active) continue;
    activeCars.push({
      carId,
      plate: carPlate,
      brand: carBrand,
      model: carModel,
      rentalId: rental.id,
      rateAmount: rental.rateAmount,
      periodicity: rental.periodicity,
      startDate: rental.startDate,
    });
  }

  let unpaidFinesCount = 0;
  let unpaidFinesSum = 0;
  for (const fine of driverFines) {
    if (fine.status === 'unpaid') {
      unpaidFinesCount += 1;
      unpaidFinesSum += fine.amount;
    }
  }

  return {
    id: driver.id,
    fullName: driver.fullName,
    phone: driver.phone,
    notes: driver.notes,
    archived: driver.archived,
    createdAt: driver.createdAt,
    activeCars,
    rentDebt30d: computeRentDebt30d(
      driverRentals.map((row) => row.rental),
      paymentsByRental,
      todayIso,
    ),
    unpaidFinesSum,
    unpaidFinesCount,
  };
}

/** Return all drivers with active cars, 30-day rental debt, and unpaid fines totals. */
export async function listDriverSummaries(
  database: AppDb,
  todayIso = getTodayIso(),
): Promise<DriverSummaryDto[]> {
  const driverRows = await database.select().from(drivers).orderBy(asc(drivers.id));
  if (driverRows.length === 0) return [];

  const [rentalRows, paymentRows, fineRows] = await Promise.all([
    database
      .select({
        rental: rentals,
        carId: cars.id,
        carPlate: cars.plate,
        carBrand: cars.brand,
        carModel: cars.model,
      })
      .from(rentals)
      .innerJoin(cars, eq(rentals.carId, cars.id))
      .where(isNotNull(rentals.driverId))
      .orderBy(desc(rentals.startDate), desc(rentals.id)),
    database
      .select({
        rentalId: rentalPayments.rentalId,
        dueDate: rentalPayments.dueDate,
        amount: rentalPayments.amount,
        paidAt: rentalPayments.paidAt,
      })
      .from(rentalPayments),
    database
      .select({
        driverId: fines.driverId,
        amount: fines.amount,
        status: fines.status,
      })
      .from(fines)
      .where(isNotNull(fines.driverId)),
  ]);

  const rentalsByDriver = new Map<number, DriverRentalJoinRow[]>();
  for (const row of rentalRows) {
    if (row.rental.driverId === null) continue;
    const list = rentalsByDriver.get(row.rental.driverId);
    if (list) list.push(row);
    else rentalsByDriver.set(row.rental.driverId, [row]);
  }

  const finesByDriver = new Map<number, DriverFineSummaryInput[]>();
  for (const fine of fineRows) {
    if (fine.driverId === null) continue;
    const list = finesByDriver.get(fine.driverId);
    if (list) list.push(fine);
    else finesByDriver.set(fine.driverId, [fine]);
  }

  const paymentsByRental = groupPaymentsByRental(paymentRows);

  return driverRows.map((driver) =>
    buildDriverSummary(
      driver,
      rentalsByDriver.get(driver.id) ?? [],
      paymentsByRental,
      finesByDriver.get(driver.id) ?? [],
      todayIso,
    ),
  );
}

/** Load full driver profile including active cars, rental history, and attributed fines. */
export async function getDriverDetail(
  database: AppDb,
  driverId: number,
  todayIso = getTodayIso(),
): Promise<DriverDetailDto | null> {
  const [driver] = await database.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver) return null;

  const [rentalRows, fineRows] = await Promise.all([
    database
      .select({
        rental: rentals,
        carId: cars.id,
        carPlate: cars.plate,
        carBrand: cars.brand,
        carModel: cars.model,
      })
      .from(rentals)
      .innerJoin(cars, eq(rentals.carId, cars.id))
      .where(eq(rentals.driverId, driverId))
      .orderBy(desc(rentals.startDate), desc(rentals.id)),
    database
      .select({
        fine: fines,
        carPlate: cars.plate,
      })
      .from(fines)
      .innerJoin(cars, eq(fines.carId, cars.id))
      .where(eq(fines.driverId, driverId))
      .orderBy(desc(fines.violatedAt), desc(fines.id)),
  ]);

  const rentalIds = rentalRows.map((row) => row.rental.id);
  const paymentRows =
    rentalIds.length > 0
      ? await database
          .select({
            rentalId: rentalPayments.rentalId,
            dueDate: rentalPayments.dueDate,
            amount: rentalPayments.amount,
            paidAt: rentalPayments.paidAt,
          })
          .from(rentalPayments)
          .where(inArray(rentalPayments.rentalId, rentalIds))
      : [];
  const paymentsByRental = groupPaymentsByRental(paymentRows);

  const summary = buildDriverSummary(
    driver,
    rentalRows,
    paymentsByRental,
    fineRows.map((row) => row.fine),
    todayIso,
  );

  const rentalsHistory: DriverRentalHistoryDto[] = rentalRows.map(
    ({ rental, carPlate, carBrand, carModel }) => {
      const timeline = buildRentalTimeline(
        rental,
        paymentsByRental.get(rental.id) ?? [],
        todayIso,
      );
      const rentDebt30d = timeline.reduce(
        (sum, item) => (item.status === 'overdue' ? sum + item.amount : sum),
        0,
      );
      return {
        id: rental.id,
        carId: rental.carId,
        driverId: rental.driverId,
        renterName: driver.fullName,
        driverPhone: driver.phone,
        rateAmount: rental.rateAmount,
        periodicity: rental.periodicity,
        startDate: rental.startDate,
        endDate: rental.endDate,
        active: rental.active,
        managerCommissionPercent: rental.managerCommissionPercent,
        rentDebt30d,
        carPlate,
        carBrand,
        carModel,
        timeline,
      };
    },
  );

  const driverFines: DriverFineDto[] = fineRows.map(({ fine, carPlate }) => ({
    id: fine.id,
    carId: fine.carId,
    driverId: fine.driverId,
    driverName: driver.fullName,
    resolutionNumber: fine.resolutionNumber,
    violatedAt: fine.violatedAt,
    amount: fine.amount,
    discountAmount: fine.discountAmount,
    discountDeadline: fine.discountDeadline,
    paymentDeadline: fine.paymentDeadline,
    description: fine.description,
    status: fine.status,
    carPlate,
  }));

  return {
    ...summary,
    rentalsHistory,
    fines: driverFines,
  };
}
