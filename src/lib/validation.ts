import { z } from 'zod';
import {
  CAR_DOCUMENT_TYPES,
  type CarDocumentType,
  type CarStatus,
  type FineStatus,
  type RentalPeriodicity,
  type UserRole,
} from '@/db/schema';
import type { CarDeadlineSummary, DeadlineState } from '@/lib/deadlines';
import type { TimelineItem } from '@/lib/rental/timeline';

export type { CarDeadlineSummary, DeadlineState };

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
  stsNumber: string | null;
  nextServiceMileage: number | null;
  nextServiceDate: string | null;
  unpaidFinesCount: number;
  unpaidFinesSum: number;
  rentDebt30d: number;
  activeDriverId: number | null;
  activeDriverName: string | null;
  deadlineStatus: DeadlineState;
  urgentDeadlinesCount: number;
};

export type FleetDashboardSummary = {
  totalRentDebt30d: number;
  totalUnpaidFinesSum: number;
  totalUnpaidFinesCount: number;
  paidRental30d: number;
  managerIncome30d: number;
  paidRentalMonth: number;
  managerIncomeMonth: number;
  maintenanceCost30d: number;
  netIncome30d: number;
  urgentDeadlineCarsCount: number;
};

export type FineDto = {
  id: number;
  carId: number;
  driverId: number | null;
  driverName: string | null;
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
  driverId: number | null;
  renterName: string;
  driverPhone: string | null;
  rateAmount: number;
  periodicity: RentalPeriodicity;
  startDate: string;
  endDate: string | null;
  active: boolean;
  managerCommissionPercent: number;
};

export type RentalHistoryItemDto = {
  id: number;
  carId: number;
  driverId: number | null;
  renterName: string;
  driverPhone: string | null;
  rateAmount: number;
  periodicity: RentalPeriodicity;
  startDate: string;
  endDate: string | null;
  active: boolean;
  managerCommissionPercent: number;
  rentDebt30d: number;
};

export type CarDocumentDto = {
  id: number;
  carId: number;
  type: CarDocumentType;
  expiresAt: string;
  policyNumber: string | null;
  notes: string | null;
  status: DeadlineState;
  daysLeft: number;
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
  documents: CarDocumentDto[];
  deadlines: CarDeadlineSummary;
  fines: FineDto[];
  rental: RentalDto | null;
  rentalHistory: RentalHistoryItemDto[];
  timeline: TimelineItem[];
  maintenance: MaintenanceDto[];
};

export type DriverDto = {
  id: number;
  fullName: string;
  phone: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
};

export type DriverActiveCarDto = {
  carId: number;
  plate: string;
  brand: string;
  model: string;
  rentalId: number;
  rateAmount: number;
  periodicity: RentalPeriodicity;
  startDate: string;
};

export type DriverSummaryDto = DriverDto & {
  activeCars: DriverActiveCarDto[];
  rentDebt30d: number;
  unpaidFinesSum: number;
  unpaidFinesCount: number;
};

export type DriverRentalHistoryDto = RentalHistoryItemDto & {
  carPlate: string;
  carBrand: string;
  carModel: string;
  timeline: TimelineItem[];
};

export type DriverFineDto = FineDto & {
  carPlate: string;
};

export type DriverDetailDto = DriverSummaryDto & {
  rentalsHistory: DriverRentalHistoryDto[];
  fines: DriverFineDto[];
};

export type SafeUserDto = {
  id: number;
  username: string;
  role: UserRole;
  createdAt: string;
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

const patchNullableString = (typeMessage: string) =>
  z
    .string(typeMessage)
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const optionalNullableString = (typeMessage: string) =>
  patchNullableString(typeMessage).transform((v) => v ?? null);

const optionalTrimmedMaxString = (typeMessage: string, maxLen: number, maxMessage: string) =>
  z
    .string(typeMessage)
    .trim()
    .max(maxLen, maxMessage)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

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

const positiveIntField = (typeMessage: string, intMessage: string, positiveMessage: string) =>
  z.number(typeMessage).int(intMessage).positive(positiveMessage);

const carStatusSchema = z.enum(
  ['in_rent', 'in_repair', 'available'],
  'Выберите статус машины',
);

const fineStatusSchema = z.enum(['unpaid', 'paid'], 'Выберите корректный статус штрафа');

const userRoleSchema = z.enum(['admin', 'viewer'], 'Выберите корректную роль пользователя');

const mileageField = z
  .number('Укажите пробег')
  .int('Пробег должен быть целым числом')
  .nonnegative('Пробег не может быть отрицательным');

const stsNumberField = optionalTrimmedMaxString(
  'Номер СТС должен быть строкой',
  32,
  'Номер СТС не длиннее 32 символов',
);

const driverIdField = positiveIntField(
  'Некорректный идентификатор водителя',
  'Идентификатор водителя должен быть целым числом',
  'Некорректный идентификатор водителя',
)
  .nullable()
  .optional();

export const createCarSchema = z.object(
  {
    plate: nonEmptyString('Укажите гос. номер'),
    brand: nonEmptyString('Укажите марку'),
    model: nonEmptyString('Укажите модель'),
    status: carStatusSchema,
    mileage: mileageField,
    stsNumber: stsNumberField,
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
      stsNumber: stsNumberField,
    },
    'Некорректные данные автомобиля',
  )
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    'Нет данных для обновления',
  );

export const createFineSchema = z.object(
  {
    driverId: driverIdField,
    resolutionNumber: nonEmptyString('Укажите номер постановления'),
    violatedAt: z
      .string('Укажите дату и время нарушения')
      .trim()
      .refine(isValidIsoDateOrDateTime, 'Некорректная дата нарушения'),
    amount: positiveIntField(
      'Укажите сумму штрафа',
      'Сумма штрафа должна быть целым числом',
      'Сумма штрафа должна быть больше нуля',
    ),
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
    status: fineStatusSchema.default('unpaid'),
  },
  'Некорректные данные штрафа',
);

export const updateFineStatusSchema = z.object(
  {
    status: fineStatusSchema,
  },
  'Некорректные данные статуса штрафа',
);

export const upsertRentalSchema = z
  .object(
    {
      driverId: driverIdField,
      renterName: z
        .string('Укажите имя арендатора')
        .trim()
        .transform((v) => (v === '' ? undefined : v))
        .nullable()
        .optional()
        .transform((v) => v ?? undefined),
      rateAmount: positiveIntField(
        'Укажите ставку аренды',
        'Ставка аренды должна быть целым числом',
        'Ставка аренды должна быть больше нуля',
      ),
      periodicity: z.enum(
        ['daily', 'weekly', 'monthly'],
        'Выберите корректную периодичность оплаты',
      ),
      startDate: isoDateField(
        'Укажите дату начала оплаты',
        'Укажите дату начала оплаты в формате ГГГГ-ММ-ДД',
      ),
      active: z.boolean('Укажите, активна ли аренда').default(true),
      managerCommissionPercent: z
        .number('Укажите процент менеджера')
        .finite('Некорректный процент менеджера')
        .min(0, 'Процент менеджера не может быть меньше 0')
        .max(100, 'Процент менеджера не может быть больше 100')
        .default(0)
        .transform((v) => Math.round(v * 100) / 100),
    },
    'Некорректные данные аренды',
  )
  .refine(
    (data) =>
      (data.driverId !== undefined && data.driverId !== null) ||
      (data.renterName !== undefined && data.renterName.length > 0),
    {
      message: 'Выберите водителя или укажите имя арендатора',
      path: ['driverId'],
    },
  );

export const endRentalSchema = z.object(
  {
    endDate: isoDateField(
      'Укажите дату окончания аренды',
      'Укажите дату окончания аренды в формате ГГГГ-ММ-ДД',
    )
      .nullable()
      .optional()
      .transform((v) => v ?? undefined),
  },
  'Некорректные данные завершения аренды',
);

export const rentalPaymentSchema = z.object(
  {
    dueDate: isoDateField('Укажите дату платежа', 'Укажите дату платежа в формате ГГГГ-ММ-ДД'),
    paid: z.boolean('Укажите статус оплаты'),
    amount: positiveIntField(
      'Укажите сумму платежа',
      'Сумма платежа должна быть целым числом',
      'Сумма платежа должна быть больше нуля',
    ).optional(),
    rentalId: positiveIntField(
      'Некорректный идентификатор аренды',
      'Идентификатор аренды должен быть целым числом',
      'Некорректный идентификатор аренды',
    ).optional(),
  },
  'Некорректные данные платежа',
);

const carDocumentInputSchema = z.object(
  {
    type: z.enum(CAR_DOCUMENT_TYPES, 'Выберите корректный тип документа'),
    expiresAt: isoDateField(
      'Укажите дату окончания документа',
      'Укажите дату окончания документа в формате ГГГГ-ММ-ДД',
    ),
    policyNumber: optionalNullableString('Номер документа должен быть строкой'),
    notes: optionalNullableString('Примечание должно быть строкой'),
  },
  'Некорректные данные документа',
);

export const upsertDocumentsSchema = z.object(
  {
    nextServiceMileage: z
      .number('Некорректный пробег следующего ТО')
      .int('Пробег следующего ТО должен быть целым числом')
      .nonnegative('Пробег следующего ТО не может быть отрицательным')
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    nextServiceDate: optionalNullableIsoDate(
      'Некорректная дата следующего ТО',
      'Укажите дату следующего ТО в формате ГГГГ-ММ-ДД',
    ),
    documents: z
      .array(carDocumentInputSchema, 'Некорректный список документов')
      .refine(
        (items) => new Set(items.map((item) => item.type)).size === items.length,
        'Типы документов не должны повторяться',
      ),
  },
  'Некорректные данные документов и ТО',
);

export const createDriverSchema = z.object(
  {
    fullName: nonEmptyString('Укажите ФИО водителя'),
    phone: optionalNullableString('Телефон должен быть строкой'),
    notes: optionalNullableString('Примечание должно быть строкой'),
  },
  'Некорректные данные водителя',
);

export const updateDriverSchema = z
  .object(
    {
      fullName: nonEmptyString('Укажите ФИО водителя').optional(),
      phone: patchNullableString('Телефон должен быть строкой'),
      notes: patchNullableString('Примечание должно быть строкой'),
      archived: z.boolean('Укажите корректный статус архива').optional(),
    },
    'Некорректные данные водителя',
  )
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    'Нет данных для обновления',
  );

const usernameField = z
  .string('Укажите логин')
  .trim()
  .min(3, 'Логин должен содержать минимум 3 символа')
  .refine((v) => !/\s/.test(v), 'Логин не должен содержать пробелы');

const passwordField = z
  .string('Укажите пароль')
  .min(6, 'Пароль должен содержать минимум 6 символов');

export const createUserSchema = z.object(
  {
    username: usernameField,
    password: passwordField,
    role: userRoleSchema,
  },
  'Некорректные данные пользователя',
);

export const updateUserSchema = z
  .object(
    {
      role: userRoleSchema.optional(),
      password: passwordField.optional(),
    },
    'Некорректные данные пользователя',
  )
  .refine(
    (data) => data.role !== undefined || data.password !== undefined,
    'Укажите новую роль или новый пароль',
  );

const maintenancePartInputSchema = z.object(
  {
    name: nonEmptyString('Укажите название запчасти'),
    sku: optionalNullableString('Артикул должен быть строкой'),
    quantity: positiveIntField(
      'Укажите количество',
      'Количество должно быть целым числом',
      'Количество должно быть больше нуля',
    ).default(1),
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
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  options?: { allowEmpty?: boolean },
): Promise<T> {
  const rawText = await request.text();
  if (options?.allowEmpty && rawText.trim() === '') {
    return schema.parse({});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new ApiError(400, 'Некорректный формат запроса');
  }
  return schema.parse(raw);
}
