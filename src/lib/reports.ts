import { and, asc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { cars, maintenanceRecords, rentalPayments, rentals } from '@/db/schema';
import { ApiError } from '@/lib/cars';
import { groupPaymentsByRental, sumPaidAndManagerInRange } from '@/lib/finances';
import { formatDateRu, formatRub, parseUtcDateMs, shiftUtcDaysIso } from '@/lib/format';
import type { CarReportBreakdown, FleetReportDto, ReportPeriodType } from '@/lib/validation';

const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const RU_MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

/** Return Monday..Sunday UTC date bounds (`YYYY-MM-DD`) for the ISO week containing `anchorIso`. */
export function getIsoWeekRange(anchorIso: string): { start: string; end: string } {
  const day = new Date(parseUtcDateMs(anchorIso)).getUTCDay();
  const offsetToMonday = day === 0 ? -6 : -(day - 1);
  const start = shiftUtcDaysIso(anchorIso, offsetToMonday);
  return { start, end: shiftUtcDaysIso(start, 6) };
}

/** Return first and last calendar day (`YYYY-MM-DD`) for `yearMonth` (`YYYY-MM`). */
export function getCalendarMonthRange(yearMonth: string): { start: string; end: string } {
  const match = YEAR_MONTH_RE.exec(yearMonth);
  if (!match) {
    throw new ApiError(400, 'Укажите месяц в формате ГГГГ-ММ');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${yearMonth}-01`,
    end: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Format a deterministic Russian period label without em/en dashes. */
export function formatReportPeriodLabel(
  type: ReportPeriodType,
  start: string,
  end: string,
): string {
  if (type === 'weekly') {
    return `неделя с ${formatDateRu(start)} по ${formatDateRu(end)}`;
  }
  const dt = new Date(parseUtcDateMs(start));
  return `${RU_MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** Format signed ruble amount deterministically across Node locales (ASCII minus for negatives). */
export function formatSignedRubPlain(amount: number): string {
  return amount < 0 ? `-${formatRub(Math.abs(amount))}` : formatRub(amount);
}

/** Format fleet report as plain text or Telegram standard Markdown (`**bold**`, no escapes). */
export function formatReportText(
  report: Omit<FleetReportDto, 'textPlain' | 'textTelegram'>,
  format: 'plain' | 'telegram',
): string {
  const bold = (text: string) => (format === 'telegram' ? `**${text}**` : text);
  const titlePrefix = report.type === 'weekly' ? 'Еженедельный отчёт' : 'Ежемесячный отчёт';

  const lines: string[] = [
    bold(`${titlePrefix} (${report.periodLabel})`),
    `Автомобиль: ${report.carLabel}`,
    '',
    `Оплаченная аренда: ${formatSignedRubPlain(report.paidRental)}`,
    `Менеджеру автопарка: ${formatSignedRubPlain(report.managerIncome)}`,
  ];

  if (report.includeMaintenance) {
    lines.push(`Ремонт: ${formatSignedRubPlain(report.maintenanceCost)}`);
  }

  lines.push(`К выплате собственнику: ${bold(formatSignedRubPlain(report.ownerPayout))}`);

  if (report.carId === null && report.cars.length > 0) {
    lines.push('');
    lines.push(bold('По машинам:'));
    for (const car of report.cars) {
      const maintPart = report.includeMaintenance
        ? `, ремонт ${formatSignedRubPlain(car.maintenanceCost)}`
        : '';
      lines.push(
        `${car.brand} ${car.model} (${car.plate}): аренда ${formatSignedRubPlain(car.paidRental)}, менеджеру ${formatSignedRubPlain(car.managerIncome)}${maintPart}, собственнику ${formatSignedRubPlain(car.ownerPayout)}`,
      );
    }
  }

  return lines.join('\n');
}

/** Build a fleet or single-car financial report over `[periodStart, periodEnd]`. */
export async function buildReport(
  database: AppDb,
  params: {
    type: ReportPeriodType;
    periodStart: string;
    periodEnd: string;
    periodLabel?: string;
    carId: number | null;
    includeMaintenance: boolean;
  },
): Promise<FleetReportDto> {
  const effectiveIncludeMaintenance =
    params.type === 'monthly' ? true : params.includeMaintenance;

  const carRows =
    params.carId !== null
      ? await database.select().from(cars).where(eq(cars.id, params.carId))
      : await database.select().from(cars).orderBy(asc(cars.id));

  if (params.carId !== null && carRows.length === 0) {
    throw new ApiError(404, 'Автомобиль не найден');
  }

  const rentalRows =
    carRows.length === 0
      ? []
      : params.carId !== null
        ? await database
            .select({
              id: rentals.id,
              carId: rentals.carId,
              managerCommissionPercent: rentals.managerCommissionPercent,
            })
            .from(rentals)
            .where(eq(rentals.carId, params.carId))
        : await database
            .select({
              id: rentals.id,
              carId: rentals.carId,
              managerCommissionPercent: rentals.managerCommissionPercent,
            })
            .from(rentals);

  const rentalIds = rentalRows.map((row) => row.id);
  const paymentRows =
    rentalIds.length === 0
      ? []
      : await database
          .select({
            rentalId: rentalPayments.rentalId,
            dueDate: rentalPayments.dueDate,
            amount: rentalPayments.amount,
            paidAt: rentalPayments.paidAt,
          })
          .from(rentalPayments)
          .where(
            and(
              inArray(rentalPayments.rentalId, rentalIds),
              isNotNull(rentalPayments.paidAt),
              gte(rentalPayments.dueDate, params.periodStart),
              lte(rentalPayments.dueDate, params.periodEnd),
            ),
          );

  const maintenanceRows =
    !effectiveIncludeMaintenance || carRows.length === 0
      ? []
      : await database
          .select({
            carId: maintenanceRecords.carId,
            totalCost: maintenanceRecords.totalCost,
          })
          .from(maintenanceRecords)
          .where(
            and(
              params.carId !== null ? eq(maintenanceRecords.carId, params.carId) : undefined,
              gte(maintenanceRecords.performedAt, params.periodStart),
              lte(maintenanceRecords.performedAt, params.periodEnd),
            ),
          );

  const rentalsByCar = new Map<number, typeof rentalRows>();
  for (const rental of rentalRows) {
    const bucket = rentalsByCar.get(rental.carId);
    if (bucket) {
      bucket.push(rental);
    } else {
      rentalsByCar.set(rental.carId, [rental]);
    }
  }

  const paymentsByRental = groupPaymentsByRental(paymentRows);

  const maintenanceSumByCar = new Map<number, number>();
  for (const record of maintenanceRows) {
    maintenanceSumByCar.set(
      record.carId,
      (maintenanceSumByCar.get(record.carId) ?? 0) + record.totalCost,
    );
  }

  let paidRental = 0;
  let managerIncome = 0;
  let maintenanceCost = 0;

  const carBreakdowns: CarReportBreakdown[] = carRows.map((car) => {
    const carRentals = rentalsByCar.get(car.id) ?? [];
    const carPayments = carRentals.flatMap((rental) => paymentsByRental.get(rental.id) ?? []);
    const { paidRental: carPaidRental, managerIncome: carManagerIncome } =
      sumPaidAndManagerInRange(carRentals, carPayments, params.periodStart, params.periodEnd);
    const carMaintenanceCost = effectiveIncludeMaintenance
      ? (maintenanceSumByCar.get(car.id) ?? 0)
      : 0;
    const carOwnerPayout = carPaidRental - carManagerIncome - carMaintenanceCost;

    paidRental += carPaidRental;
    managerIncome += carManagerIncome;
    maintenanceCost += carMaintenanceCost;

    return {
      carId: car.id,
      plate: car.plate,
      brand: car.brand,
      model: car.model,
      paidRental: carPaidRental,
      managerIncome: carManagerIncome,
      maintenanceCost: carMaintenanceCost,
      ownerPayout: carOwnerPayout,
    };
  });

  const ownerPayout = paidRental - managerIncome - maintenanceCost;
  const carLabel =
    params.carId === null
      ? 'Все машины'
      : `${carRows[0].brand} ${carRows[0].model} (${carRows[0].plate})`;
  const periodLabel =
    params.periodLabel ??
    formatReportPeriodLabel(params.type, params.periodStart, params.periodEnd);

  const baseReport: Omit<FleetReportDto, 'textPlain' | 'textTelegram'> = {
    type: params.type,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    periodLabel,
    carId: params.carId,
    carLabel,
    includeMaintenance: effectiveIncludeMaintenance,
    paidRental,
    managerIncome,
    maintenanceCost,
    ownerPayout,
    cars: carBreakdowns,
  };

  return {
    ...baseReport,
    textPlain: formatReportText(baseReport, 'plain'),
    textTelegram: formatReportText(baseReport, 'telegram'),
  };
}
