import type { FineStatus } from '@/db/schema';
import { shiftUtcDaysIso } from '@/lib/format';
import {
  buildRentalTimeline,
  type RentalTimelineInput,
  type TimelinePaymentInput,
} from '@/lib/rental/timeline';
import type { CarSummaryDto, FleetDashboardSummary } from '@/lib/validation';

export type RentalFinanceInput = RentalTimelineInput & {
  id: number;
  carId: number;
  driverId?: number | null;
  managerCommissionPercent?: number;
};

export type PaymentFinanceInput = TimelinePaymentInput & {
  rentalId: number;
};

export type FineFinanceInput = {
  carId: number;
  amount: number;
  status: FineStatus;
};

export type MaintenanceFinanceInput = {
  carId: number;
  performedAt: string;
  totalCost: number;
};

/** Return inclusive 30-day window start (`todayIso - 29` calendar days). */
export function getWindowStartIso(todayIso: string): string {
  return shiftUtcDaysIso(todayIso, -29);
}

/** Return first day of the calendar month (`YYYY-MM-01`) for `todayIso`. */
export function getMonthStartIso(todayIso: string): string {
  return `${todayIso.slice(0, 7)}-01`;
}

/** Compute rounded manager commission fee from aggregated rental payments. */
export function computeManagerFee(paidAmount: number, commissionPercent: number): number {
  return Math.round((paidAmount * commissionPercent) / 100);
}

/** Group rental payment rows by `rentalId`. */
export function groupPaymentsByRental<T extends PaymentFinanceInput>(
  payments: ReadonlyArray<T>,
): Map<number, T[]> {
  const byRental = new Map<number, T[]>();
  for (const payment of payments) {
    const existing = byRental.get(payment.rentalId);
    if (existing) {
      existing.push(payment);
    } else {
      byRental.set(payment.rentalId, [payment]);
    }
  }
  return byRental;
}

/** Sum overdue rental payment amounts across all rentals intersecting the 30-day window. */
export function computeRentDebt30d(
  rentals: ReadonlyArray<RentalTimelineInput & { id: number }>,
  paymentsByRental: ReadonlyMap<number, TimelinePaymentInput[]>,
  todayIso: string,
): number {
  let total = 0;
  for (const rental of rentals) {
    const items = buildRentalTimeline(rental, paymentsByRental.get(rental.id) ?? [], todayIso);
    for (const item of items) {
      if (item.status === 'overdue') {
        total += item.amount;
      }
    }
  }
  return total;
}

/** Sum paid rental amounts and manager commission per rental over `[fromIso, toIso]`. */
export function sumPaidAndManagerInRange(
  rentals: ReadonlyArray<{ id: number; managerCommissionPercent?: number }>,
  payments: ReadonlyArray<PaymentFinanceInput>,
  fromIso: string,
  toIso: string,
): { paidRental: number; managerIncome: number } {
  const commissionByRental = new Map<number, number>();
  for (const rental of rentals) {
    commissionByRental.set(rental.id, rental.managerCommissionPercent ?? 0);
  }

  const paidByRental = new Map<number, number>();
  for (const payment of payments) {
    if (
      payment.paidAt !== null &&
      payment.dueDate >= fromIso &&
      payment.dueDate <= toIso &&
      commissionByRental.has(payment.rentalId)
    ) {
      paidByRental.set(payment.rentalId, (paidByRental.get(payment.rentalId) ?? 0) + payment.amount);
    }
  }

  let paidRental = 0;
  let managerIncome = 0;
  for (const [rentalId, rentalPaid] of paidByRental) {
    paidRental += rentalPaid;
    managerIncome += computeManagerFee(rentalPaid, commissionByRental.get(rentalId) ?? 0);
  }

  return { paidRental, managerIncome };
}

function sumMaintenanceInWindow(
  maintenance: ReadonlyArray<Pick<MaintenanceFinanceInput, 'performedAt' | 'totalCost'>>,
  windowStartIso: string,
  todayIso: string,
): number {
  let total = 0;
  for (const record of maintenance) {
    if (record.performedAt >= windowStartIso && record.performedAt <= todayIso) {
      total += record.totalCost;
    }
  }
  return total;
}

/** Compute 30-day rental debt, unpaid fines, and 30-day cashflow metrics for one vehicle. */
export function computeCarFinances(
  carId: number,
  rentals: ReadonlyArray<RentalFinanceInput>,
  payments: ReadonlyArray<PaymentFinanceInput>,
  fines: ReadonlyArray<FineFinanceInput>,
  maintenance: ReadonlyArray<MaintenanceFinanceInput>,
  todayIso: string,
): {
  rentDebt30d: number;
  unpaidFinesSum: number;
  unpaidFinesCount: number;
  paidRental30d: number;
  managerIncome30d: number;
  maintenanceCost30d: number;
  netIncome30d: number;
} {
  const windowStartIso = getWindowStartIso(todayIso);
  const carRentals = rentals.filter((rental) => rental.carId === carId);
  const carRentalIds = new Set(carRentals.map((rental) => rental.id));
  const carPayments = payments.filter((payment) => carRentalIds.has(payment.rentalId));
  const paymentsByRental = groupPaymentsByRental(carPayments);

  const rentDebt30d = computeRentDebt30d(carRentals, paymentsByRental, todayIso);
  const { paidRental: paidRental30d, managerIncome: managerIncome30d } = sumPaidAndManagerInRange(
    carRentals,
    carPayments,
    windowStartIso,
    todayIso,
  );
  const maintenanceCost30d = sumMaintenanceInWindow(
    maintenance.filter((record) => record.carId === carId),
    windowStartIso,
    todayIso,
  );

  let unpaidFinesSum = 0;
  let unpaidFinesCount = 0;
  for (const fine of fines) {
    if (fine.carId === carId && fine.status === 'unpaid') {
      unpaidFinesSum += fine.amount;
      unpaidFinesCount += 1;
    }
  }

  return {
    rentDebt30d,
    unpaidFinesSum,
    unpaidFinesCount,
    paidRental30d,
    managerIncome30d,
    maintenanceCost30d,
    netIncome30d: paidRental30d - managerIncome30d - maintenanceCost30d,
  };
}

/** Aggregate fleet-wide 30-day and calendar month financial KPIs and urgent deadline vehicle count for dashboard. */
export function computeFleetFinancialSummary(
  cars: ReadonlyArray<CarSummaryDto>,
  rentals: ReadonlyArray<RentalTimelineInput & { id: number; managerCommissionPercent?: number }>,
  payments: ReadonlyArray<PaymentFinanceInput>,
  maintenance: ReadonlyArray<Pick<MaintenanceFinanceInput, 'performedAt' | 'totalCost'>>,
  todayIso: string,
  options?: {
    fines?: ReadonlyArray<Pick<FineFinanceInput, 'amount' | 'status'>>;
    urgentDeadlineCarsCount?: number;
  },
): FleetDashboardSummary {
  const windowStartIso = getWindowStartIso(todayIso);
  const monthStartIso = getMonthStartIso(todayIso);
  const paymentsByRental = groupPaymentsByRental(payments);
  const totalRentDebt30d = computeRentDebt30d(rentals, paymentsByRental, todayIso);
  const { paidRental: paidRental30d, managerIncome: managerIncome30d } = sumPaidAndManagerInRange(
    rentals,
    payments,
    windowStartIso,
    todayIso,
  );
  const { paidRental: paidRentalMonth, managerIncome: managerIncomeMonth } =
    sumPaidAndManagerInRange(rentals, payments, monthStartIso, todayIso);
  const maintenanceCost30d = sumMaintenanceInWindow(maintenance, windowStartIso, todayIso);

  let totalUnpaidFinesSum = 0;
  let totalUnpaidFinesCount = 0;
  if (options?.fines !== undefined) {
    for (const fine of options.fines) {
      if (fine.status === 'unpaid') {
        totalUnpaidFinesSum += fine.amount;
        totalUnpaidFinesCount += 1;
      }
    }
  } else {
    for (const car of cars) {
      totalUnpaidFinesSum += car.unpaidFinesSum ?? 0;
      totalUnpaidFinesCount += car.unpaidFinesCount;
    }
  }

  const urgentDeadlineCarsCount =
    options?.urgentDeadlineCarsCount ??
    cars.filter((car) => car.deadlineStatus === 'warning' || car.deadlineStatus === 'expired')
      .length;

  return {
    totalRentDebt30d,
    totalUnpaidFinesSum,
    totalUnpaidFinesCount,
    paidRental30d,
    managerIncome30d,
    paidRentalMonth,
    managerIncomeMonth,
    maintenanceCost30d,
    netIncome30d: paidRental30d - managerIncome30d - maintenanceCost30d,
    urgentDeadlineCarsCount,
  };
}
