import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export type UserRole = 'admin' | 'viewer' | 'owner';
export type CarStatus = 'in_rent' | 'in_repair' | 'available';
export type RentalPeriodicity = 'daily' | 'weekly' | 'monthly';
export type FineStatus = 'unpaid' | 'paid';

export const CAR_DOCUMENT_TYPES = ['osago', 'tech_inspection', 'taxi_license', 'kasko'] as const;
export type CarDocumentType = (typeof CAR_DOCUMENT_TYPES)[number];

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'viewer', 'owner'] }).$type<UserRole>().notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

export const drivers = sqliteTable('drivers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  notes: text('notes'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const cars = sqliteTable('cars', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  plate: text('plate').notNull().unique(),
  brand: text('brand').notNull(),
  model: text('model').notNull(),
  status: text('status', { enum: ['in_rent', 'in_repair', 'available'] })
    .$type<CarStatus>()
    .notNull(),
  mileage: integer('mileage').notNull().default(0),
  stsNumber: text('sts_number'),
  nextServiceMileage: integer('next_service_mileage'),
  nextServiceDate: text('next_service_date'),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const carDocuments = sqliteTable(
  'car_documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    carId: integer('car_id')
      .notNull()
      .references(() => cars.id, { onDelete: 'cascade' }),
    type: text('type', { enum: CAR_DOCUMENT_TYPES }).$type<CarDocumentType>().notNull(),
    expiresAt: text('expires_at').notNull(),
    policyNumber: text('policy_number'),
    notes: text('notes'),
  },
  (table) => [uniqueIndex('car_documents_car_type_idx').on(table.carId, table.type)],
);

export const rentals = sqliteTable(
  'rentals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    carId: integer('car_id')
      .notNull()
      .references(() => cars.id, { onDelete: 'cascade' }),
    driverId: integer('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    renterName: text('renter_name').notNull(),
    rateAmount: integer('rate_amount').notNull(),
    periodicity: text('periodicity', { enum: ['daily', 'weekly', 'monthly'] })
      .$type<RentalPeriodicity>()
      .notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    managerCommissionPercent: real('manager_commission_percent').notNull().default(0),
  },
  (table) => [uniqueIndex('rentals_active_car_unique').on(table.carId).where(sql`active = 1`)],
);

export const rentalPayments = sqliteTable(
  'rental_payments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rentalId: integer('rental_id')
      .notNull()
      .references(() => rentals.id, { onDelete: 'cascade' }),
    dueDate: text('due_date').notNull(),
    amount: integer('amount').notNull(),
    paidAt: text('paid_at'),
  },
  (table) => [uniqueIndex('rental_payments_rental_due_idx').on(table.rentalId, table.dueDate)],
);

export const fines = sqliteTable('fines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  carId: integer('car_id')
    .notNull()
    .references(() => cars.id, { onDelete: 'cascade' }),
  driverId: integer('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
  resolutionNumber: text('resolution_number').notNull().unique(),
  violatedAt: text('violated_at').notNull(),
  amount: integer('amount').notNull(),
  discountAmount: integer('discount_amount'),
  discountDeadline: text('discount_deadline'),
  paymentDeadline: text('payment_deadline').notNull(),
  description: text('description').notNull(),
  status: text('status', { enum: ['unpaid', 'paid'] }).$type<FineStatus>().notNull(),
});

export const maintenanceRecords = sqliteTable('maintenance_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  carId: integer('car_id')
    .notNull()
    .references(() => cars.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  performedAt: text('performed_at').notNull(),
  mileage: integer('mileage').notNull(),
  laborCost: integer('labor_cost').notNull(),
  totalCost: integer('total_cost').notNull(),
  notes: text('notes'),
});

export const maintenanceParts = sqliteTable('maintenance_parts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  recordId: integer('record_id')
    .notNull()
    .references(() => maintenanceRecords.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sku: text('sku'),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: integer('unit_price').notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type DriverRow = typeof drivers.$inferSelect;
export type CarRow = typeof cars.$inferSelect;
export type CarDocumentRow = typeof carDocuments.$inferSelect;
export type RentalRow = typeof rentals.$inferSelect;
export type RentalPaymentRow = typeof rentalPayments.$inferSelect;
export type FineRow = typeof fines.$inferSelect;
export type MaintenanceRecordRow = typeof maintenanceRecords.$inferSelect;
export type MaintenancePartRow = typeof maintenanceParts.$inferSelect;
