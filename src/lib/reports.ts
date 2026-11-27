import { and, asc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { AppDb } from '@/db';
import { cars, maintenanceRecords, rentalPayments, rentals, users } from '@/db/schema';
import { ApiError } from '@/lib/cars';
import { groupPaymentsByRental, sumPaidAndManagerInRange } from '@/lib/finances';
import {
  formatDateRu,
  formatSignedRubPlain,
  parseUtcDateMs,
  shiftUtcDaysIso,
} from '@/lib/format';
export { formatSignedRubPlain };
import { formatUserLabel } from '@/lib/users';
import type {
  CarReportBreakdown,
  FleetReportDto,
  ReportMaintenanceItem,
  ReportPeriodType,
} from '@/lib/validation';

const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^(20\d{2}|2100)$/;

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

/** Return first and last calendar day (`YYYY-MM-DD`) for `year` (`2000..2100`). */
export function getCalendarYearRange(year: string): { start: string; end: string } {
  if (!YEAR_RE.test(year)) {
    throw new ApiError(400, 'Укажите год в формате ГГГГ (от 2000 до 2100)');
  }
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
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
  if (type === 'yearly') {
    return `${dt.getUTCFullYear()} год`;
  }
  return `${RU_MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

function sanitizeReportLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function sanitizeTelegramText(text: string): string {
  return sanitizeReportLine(text)
    .replaceAll('`', "'")
    .replaceAll('**', '')
    .replaceAll('__', '');
}

/** Format fleet report as plain text or rich Telegram standard Markdown (`**bold**`, `__italic__`, `` `code` ``, `>` quote). */
export function formatReportText(
  report: Omit<FleetReportDto, 'textPlain' | 'textTelegram'>,
  format: 'plain' | 'telegram',
): string {
  const isTg = format === 'telegram';
  const clean = (text: string) => (isTg ? sanitizeTelegramText(text) : sanitizeReportLine(text));
  const bold = (text: string) => (isTg ? `**${text}**` : text);
  const italic = (text: string) => (isTg ? `__${text}__` : text);
  const mono = (text: string) => (isTg ? `\`${text}\`` : text);
  const quote = (text: string) => (isTg ? `> ${text}` : text);

  const periodNoun =
    report.type === 'weekly'
      ? 'Еженедельный'
      : report.type === 'monthly'
        ? 'Ежемесячный'
        : 'Годовой';
  const reportKind =
    report.includeFinancial && report.includeMaintenance
      ? 'отчёт'
      : report.includeFinancial
        ? 'финансовый отчёт'
        : 'отчёт по ремонту';

  const singleCar = report.carId !== null ? report.cars[0] : undefined;
  const scopeLine = isTg
    ? report.ownerId !== null
      ? `Собственник: ${bold(clean(report.ownerName ?? ''))}`
      : singleCar
        ? `Автомобиль: ${bold(`${clean(singleCar.brand)} ${clean(singleCar.model)}`)} (${mono(clean(singleCar.plate))})`
        : `Автомобиль: ${bold(clean(report.carLabel))}`
    : report.ownerId !== null
      ? `Собственник: ${clean(report.ownerName ?? '')}`
      : `Автомобиль: ${clean(report.carLabel)}`;

  const lines: string[] = isTg
    ? [bold(`${periodNoun} ${reportKind}`), italic(clean(report.periodLabel)), scopeLine]
    : [bold(`${periodNoun} ${reportKind} (${clean(report.periodLabel)})`), scopeLine];

  if (report.includeFinancial) {
    lines.push(
      '',
      quote(`Оплаченная аренда: ${mono(formatSignedRubPlain(report.paidRental))}`),
      quote(`Менеджеру автопарка: ${mono(formatSignedRubPlain(report.managerIncome))}`),
    );
    if (report.includeMaintenance) {
      lines.push(quote(`Ремонт: ${mono(formatSignedRubPlain(report.maintenanceCost))}`));
    }
    lines.push(quote(`К выплате собственнику: ${bold(formatSignedRubPlain(report.ownerPayout))}`));

    if (report.carId === null && report.cars.length > 0) {
      lines.push('', bold('По машинам:'));
      for (const car of report.cars) {
        const carName = `${clean(car.brand)} ${clean(car.model)}`;
        const carPlate = clean(car.plate);
        if (isTg) {
          const maintPart = report.includeMaintenance
            ? `, ремонт ${mono(formatSignedRubPlain(car.maintenanceCost))}`
            : '';
          lines.push(
            `• ${bold(carName)} (${mono(carPlate)}): аренда ${mono(formatSignedRubPlain(car.paidRental))}, менеджеру ${mono(formatSignedRubPlain(car.managerIncome))}${maintPart}, собственнику ${bold(formatSignedRubPlain(car.ownerPayout))}`,
          );
        } else {
          const maintPart = report.includeMaintenance
            ? `, ремонт ${formatSignedRubPlain(car.maintenanceCost)}`
            : '';
          lines.push(
            `${carName} (${carPlate}): аренда ${formatSignedRubPlain(car.paidRental)}, менеджеру ${formatSignedRubPlain(car.managerIncome)}${maintPart}, собственнику ${formatSignedRubPlain(car.ownerPayout)}`,
          );
        }
      }
    }
  }

  if (report.includeMaintenance) {
    lines.push('');
    if (!report.includeFinancial) {
      lines.push(
        quote(
          `Итого на ремонт: ${bold(formatSignedRubPlain(report.maintenanceCost))} (${italic(`записей: ${report.maintenanceCount}`)})`,
        ),
        '',
      );
    }
    lines.push(bold('Работы по ремонту:'));
    const carsWithMaintenance = report.cars.filter((car) => car.maintenanceItems.length > 0);
    if (carsWithMaintenance.length === 0) {
      lines.push(italic('Работ по ремонту за период не было'));
    } else {
      for (const car of carsWithMaintenance) {
        const carName = `${clean(car.brand)} ${clean(car.model)}`;
        const carPlate = clean(car.plate);
        if (report.carId === null) {
          lines.push(
            isTg
              ? `${bold(carName)} (${mono(carPlate)}): ${mono(formatSignedRubPlain(car.maintenanceCost))}`
              : `${carName} (${carPlate}): ${formatSignedRubPlain(car.maintenanceCost)}`,
          );
        }
        for (const item of car.maintenanceItems) {
          const title = clean(item.title);
          lines.push(
            isTg
              ? quote(`${mono(formatDateRu(item.performedAt))}, ${title}: ${mono(formatSignedRubPlain(item.totalCost))}`)
              : `- ${formatDateRu(item.performedAt)}, ${title}: ${formatSignedRubPlain(item.totalCost)}`,
          );
        }
      }
    }
  }

  return lines.join('\n');
}

/** Build a fleet, owner-scoped, or single-car report over `[periodStart, periodEnd]`. */
export async function buildReport(
  database: AppDb,
  params: {
    type: ReportPeriodType;
    periodStart: string;
    periodEnd: string;
    periodLabel?: string;
    carId: number | null;
    ownerId?: number | null;
    includeFinancial?: boolean;
    includeMaintenance: boolean;
  },
): Promise<FleetReportDto> {
  const effectiveOwnerId = params.ownerId ?? null;
  const effectiveIncludeFinancial = params.includeFinancial ?? true;
  const effectiveIncludeMaintenance = Boolean(params.includeMaintenance);

  if (params.carId !== null && effectiveOwnerId !== null) {
    throw new ApiError(400, 'Укажите либо автомобиль, либо собственника');
  }
  if (!effectiveIncludeFinancial && !effectiveIncludeMaintenance) {
    throw new ApiError(400, 'Выберите хотя бы один раздел отчёта');
  }

  let ownerName: string | null = null;
  if (effectiveOwnerId !== null) {
    const [ownerRow] = await database
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, effectiveOwnerId));

    if (!ownerRow || ownerRow.role !== 'owner') {
      throw new ApiError(404, 'Собственник не найден');
    }
    ownerName = formatUserLabel(ownerRow);
  }

  const carRows =
    params.carId !== null
      ? await database.select().from(cars).where(eq(cars.id, params.carId))
      : effectiveOwnerId !== null
        ? await database
            .select()
            .from(cars)
            .where(eq(cars.ownerId, effectiveOwnerId))
            .orderBy(asc(cars.id))
        : await database.select().from(cars).orderBy(asc(cars.id));

  if (params.carId !== null && carRows.length === 0) {
    throw new ApiError(404, 'Автомобиль не найден');
  }

  const carIds = carRows.map((car) => car.id);

  const rentalRows =
    !effectiveIncludeFinancial || carIds.length === 0
      ? []
      : await database
          .select({
            id: rentals.id,
            carId: rentals.carId,
            managerCommissionPercent: rentals.managerCommissionPercent,
          })
          .from(rentals)
          .where(inArray(rentals.carId, carIds));

  const rentalIds = rentalRows.map((row) => row.id);
  const paymentRows =
    !effectiveIncludeFinancial || rentalIds.length === 0
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
    !effectiveIncludeMaintenance || carIds.length === 0
      ? []
      : await database
          .select({
            id: maintenanceRecords.id,
            carId: maintenanceRecords.carId,
            title: maintenanceRecords.title,
            performedAt: maintenanceRecords.performedAt,
            mileage: maintenanceRecords.mileage,
            totalCost: maintenanceRecords.totalCost,
          })
          .from(maintenanceRecords)
          .where(
            and(
              inArray(maintenanceRecords.carId, carIds),
              gte(maintenanceRecords.performedAt, params.periodStart),
              lte(maintenanceRecords.performedAt, params.periodEnd),
            ),
          )
          .orderBy(asc(maintenanceRecords.performedAt), asc(maintenanceRecords.id));

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
  const maintenanceItemsByCar = new Map<number, ReportMaintenanceItem[]>();
  for (const record of maintenanceRows) {
    maintenanceSumByCar.set(
      record.carId,
      (maintenanceSumByCar.get(record.carId) ?? 0) + record.totalCost,
    );
    const item: ReportMaintenanceItem = {
      id: record.id,
      performedAt: record.performedAt,
      title: record.title,
      mileage: record.mileage,
      totalCost: record.totalCost,
    };
    const bucket = maintenanceItemsByCar.get(record.carId);
    if (bucket) {
      bucket.push(item);
    } else {
      maintenanceItemsByCar.set(record.carId, [item]);
    }
  }

  let paidRental = 0;
  let managerIncome = 0;
  let maintenanceCost = 0;

  const carBreakdowns: CarReportBreakdown[] = carRows.map((car) => {
    let carPaidRental = 0;
    let carManagerIncome = 0;
    if (effectiveIncludeFinancial) {
      const carRentals = rentalsByCar.get(car.id) ?? [];
      const carPayments = carRentals.flatMap((rental) => paymentsByRental.get(rental.id) ?? []);
      const summed = sumPaidAndManagerInRange(
        carRentals,
        carPayments,
        params.periodStart,
        params.periodEnd,
      );
      carPaidRental = summed.paidRental;
      carManagerIncome = summed.managerIncome;
    }

    const carMaintenanceCost = effectiveIncludeMaintenance
      ? (maintenanceSumByCar.get(car.id) ?? 0)
      : 0;
    const carMaintenanceItems = effectiveIncludeMaintenance
      ? (maintenanceItemsByCar.get(car.id) ?? [])
      : [];
    const carOwnerPayout = effectiveIncludeFinancial
      ? carPaidRental - carManagerIncome - carMaintenanceCost
      : 0;

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
      maintenanceItems: carMaintenanceItems,
    };
  });

  const ownerPayout = effectiveIncludeFinancial ? paidRental - managerIncome - maintenanceCost : 0;
  const maintenanceCount = effectiveIncludeMaintenance ? maintenanceRows.length : 0;
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
    ownerId: effectiveOwnerId,
    ownerName,
    includeFinancial: effectiveIncludeFinancial,
    includeMaintenance: effectiveIncludeMaintenance,
    paidRental,
    managerIncome,
    maintenanceCost,
    maintenanceCount,
    ownerPayout,
    cars: carBreakdowns,
  };

  return {
    ...baseReport,
    textPlain: formatReportText(baseReport, 'plain'),
    textTelegram: formatReportText(baseReport, 'telegram'),
  };
}
