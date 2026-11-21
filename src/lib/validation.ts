import { z } from 'zod';
import type { CarStatus, FineStatus, RentalPeriodicity } from '@/db/schema';
import type { TimelineItem } from '@/lib/rental/timeline';

z.config(z.locales.ru());

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type CarSummaryDto = {
  id: number;
  plate: string;
  brand: string;
  model: string;
  status: CarStatus;
  mileage: number;
  unpaidFinesCount: number;
};

export type FineDto = {
  id: number;
  carId: number;
  resolutionNumber: string;
  violatedAt: string;
  amount: number;
  discountAmount: number | null;
  discountDeadline: string | null;
  paymentDeadline: string;
  description: string;
  status: FineStatus;
};

export type RentalDto = {
  id: number;
  carId: number;
  renterName: string;
  rateAmount: number;
  periodicity: RentalPeriodicity;
  startDate: string;
  active: boolean;
};

export type RentalPaymentDto = {
  id: number;
  rentalId: number;
  dueDate: string;
  amount: number;
  paidAt: string | null;
};

export type MaintenancePartDto = {
  id: number;
  recordId: number;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
};

export type MaintenanceDto = {
  id: number;
  carId: number;
  title: string;
  performedAt: string;
  mileage: number;
  laborCost: number;
  totalCost: number;
  notes: string | null;
  parts: MaintenancePartDto[];
};

export type CarDetailDto = CarSummaryDto & {
  fines: FineDto[];
  rental: RentalDto | null;
  timeline: TimelineItem[];
  maintenance: MaintenanceDto[];
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function isValidIsoDateOrDateTime(value: string): boolean {
  const match = ISO_DATETIME_RE.exec(value);
  if (!match || !isValidIsoDate(match[1])) return false;
  if (match[2] !== undefined) {
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    const second = match[4] !== undefined ? Number(match[4]) : 0;
    if (hour > 23 || minute > 59 || second > 59) return false;
  }
  return true;
}

const nonEmptyString = (message: string) => z.string(message).trim().min(1, message);

const optionalNullableString = (typeMessage: string) =>
  z
    .string(typeMessage)
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const isoDateField = (missingMessage: string, formatMessage: string) =>
  z.string(missingMessage).trim().refine(isValidIsoDate, formatMessage);

const optionalNullableIsoDate = (typeMessage: string, formatMessage: string) =>
  z
    .string(typeMessage)
    .trim()
    .refine((v) => v === '' || isValidIsoDate(v), formatMessage)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const carStatusSchema = z.enum(
  ['in_rent', 'in_repair', 'available'],
  'Выберите статус машины',
);

const mileageField = z
  .number('Укажите пробег')
  .int('Пробег должен быть целым числом')
  .nonnegative('Пробег не может быть отрицательным');

export const createCarSchema = z.object(
  {
    plate: nonEmptyString('Укажите гос. номер'),
    brand: nonEmptyString('Укажите марку'),
    model: nonEmptyString('Укажите модель'),
    status: carStatusSchema,
    mileage: mileageField,
  },
  'Некорректные данные автомобиля',
);

export const updateCarSchema = z
  .object(
    {
      plate: nonEmptyString('Укажите гос. номер').optional(),
      brand: nonEmptyString('Укажите марку').optional(),
      model: nonEmptyString('Укажите модель').optional(),
      status: carStatusSchema.optional(),
      mileage: mileageField.optional(),
    },
    'Некорректные данные автомобиля',
  )
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    'Нет данных для обновления',
  );

export const createFineSchema = z.object(
  {
    resolutionNumber: nonEmptyString('Укажите номер постановления'),
    violatedAt: z
      .string('Укажите дату и время нарушения')
      .trim()
      .refine(isValidIsoDateOrDateTime, 'Некорректная дата нарушения'),
    amount: z
      .number('Укажите сумму штрафа')
      .int('Сумма штрафа должна быть целым числом')
      .positive('Сумма штрафа должна быть больше нуля'),
    discountAmount: z
      .number('Некорректная сумма со скидкой')
      .int('Сумма со скидкой должна быть целым числом')
      .nonnegative('Сумма со скидкой не может быть отрицательной')
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    discountDeadline: optionalNullableIsoDate(
      'Некорректная дата окончания скидки',
      'Укажите дату окончания скидки в формате ГГГГ-ММ-ДД',
    ),
    paymentDeadline: isoDateField(
      'Укажите крайний срок оплаты',
      'Укажите крайний срок оплаты в формате ГГГГ-ММ-ДД',
    ),
    description: nonEmptyString('Укажите описание нарушения'),
    status: z.enum(['unpaid', 'paid'], 'Выберите корректный статус штрафа').default('unpaid'),
  },
  'Некорректные данные штрафа',
);

export const upsertRentalSchema = z.object(
  {
    renterName: nonEmptyString('Укажите имя арендатора'),
    rateAmount: z
      .number('Укажите ставку аренды')
      .int('Ставка аренды должна быть целым числом')
      .positive('Ставка аренды должна быть больше нуля'),
    periodicity: z.enum(
      ['daily', 'weekly', 'monthly'],
      'Выберите корректную периодичность оплаты',
    ),
    startDate: isoDateField(
      'Укажите дату начала оплаты',
      'Укажите дату начала оплаты в формате ГГГГ-ММ-ДД',
    ),
    active: z.boolean('Укажите, активна ли аренда').default(true),
  },
  'Некорректные данные аренды',
);

export const rentalPaymentSchema = z.object(
  {
    dueDate: isoDateField('Укажите дату платежа', 'Укажите дату платежа в формате ГГГГ-ММ-ДД'),
    paid: z.boolean('Укажите статус оплаты'),
    amount: z
      .number('Укажите сумму платежа')
      .int('Сумма платежа должна быть целым числом')
      .positive('Сумма платежа должна быть больше нуля')
      .optional(),
  },
  'Некорректные данные платежа',
);

const maintenancePartInputSchema = z.object(
  {
    name: nonEmptyString('Укажите название запчасти'),
    sku: optionalNullableString('Артикул должен быть строкой'),
    quantity: z
      .number('Укажите количество')
      .int('Количество должно быть целым числом')
      .positive('Количество должно быть больше нуля')
      .default(1),
    unitPrice: z
      .number('Укажите цену запчасти')
      .int('Цена запчасти должна быть целым числом')
      .nonnegative('Цена запчасти не может быть отрицательной'),
  },
  'Некорректные данные запчасти',
);

export const createMaintenanceSchema = z.object(
  {
    title: nonEmptyString('Укажите название работ'),
    performedAt: isoDateField(
      'Укажите дату работ',
      'Укажите дату работ в формате ГГГГ-ММ-ДД',
    ),
    mileage: mileageField,
    laborCost: z
      .number('Укажите стоимость работ')
      .int('Стоимость работ должна быть целым числом')
      .nonnegative('Стоимость работ не может быть отрицательной'),
    notes: optionalNullableString('Примечание должно быть строкой'),
    parts: z.array(maintenancePartInputSchema, 'Некорректный список запчастей').default([]),
  },
  'Некорректные данные записи ТО',
);

/** Parse a strictly positive safe integer ID string, returning null otherwise. */
export function parsePositiveIntId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Read JSON body and validate with a Zod schema. */
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, 'Некорректный формат запроса');
  }
  return schema.parse(raw);
}
