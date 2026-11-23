import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/auth/password';
import { resolveFineDriverId } from '../lib/fines/attribution';
import type { AppDb } from './index';
import {
  carDocuments,
  cars,
  drivers,
  fines,
  maintenanceParts,
  maintenanceRecords,
  rentalPayments,
  rentals,
  users,
} from './schema';

function isoDateOffset(baseUtcMs: number, daysOffset: number): string {
  return new Date(baseUtcMs + daysOffset * 86_400_000).toISOString().slice(0, 10);
}

/** Populate baseline users, drivers, fleet cars, documents, rentals, fines, and service records idempotently. */
export async function seedDatabase(database: AppDb): Promise<void> {
  await database
    .insert(users)
    .values([
      { username: 'admin', passwordHash: hashPassword('admin123'), role: 'admin' },
      { username: 'viewer', passwordHash: hashPassword('viewer123'), role: 'viewer' },
    ])
    .onConflictDoNothing({ target: users.username });

  const todayStr = new Date().toISOString().slice(0, 10);
  const baseUtcMs = Date.parse(`${todayStr}T00:00:00Z`);

  const seedCars = [
    {
      plate: 'А123ВС 777',
      brand: 'Kia',
      model: 'Rio',
      status: 'in_rent' as const,
      mileage: 142500,
      stsNumber: '99 01 112233',
      nextServiceMileage: 150000,
      nextServiceDate: isoDateOffset(baseUtcMs, 45),
    },
    {
      plate: 'В456ОР 777',
      brand: 'Hyundai',
      model: 'Solaris',
      status: 'in_rent' as const,
      mileage: 98400,
      stsNumber: '77 44 556677',
      nextServiceMileage: 99000,
      nextServiceDate: isoDateOffset(baseUtcMs, 10),
    },
    {
      plate: 'Е789КХ 799',
      brand: 'Skoda',
      model: 'Octavia',
      status: 'in_repair' as const,
      mileage: 215300,
      stsNumber: '99 02 889900',
      nextServiceMileage: 215000,
      nextServiceDate: isoDateOffset(baseUtcMs, -3),
    },
    {
      plate: 'М321ТН 777',
      brand: 'Geely',
      model: 'Coolray',
      status: 'available' as const,
      mileage: 34100,
      stsNumber: null,
      nextServiceMileage: 42500,
      nextServiceDate: isoDateOffset(baseUtcMs, 60),
    },
  ];

  await database.insert(cars).values(seedCars).onConflictDoNothing({ target: cars.plate });

  const carRows = await database.select().from(cars);
  const carByPlate = new Map(carRows.map((c) => [c.plate, c]));

  const kia = carByPlate.get('А123ВС 777');
  const hyundai = carByPlate.get('В456ОР 777');
  const skoda = carByPlate.get('Е789КХ 799');
  const geely = carByPlate.get('М321ТН 777');
  if (!kia || !hyundai || !skoda || !geely) return;

  const seedDrivers = [
    {
      fullName: 'Иванов Алексей Сергеевич',
      phone: '+7 916 111-22-33',
      notes: 'Основной водитель Kia Rio',
    },
    {
      fullName: 'Смирнов Дмитрий Павлович',
      phone: '+7 925 222-33-44',
      notes: null,
    },
    {
      fullName: 'Петров Олег Николаевич',
      phone: '+7 903 333-44-55',
      notes: 'Завершённая аренда Skoda Octavia до ремонта',
    },
  ];

  const existingDrivers = await database.select().from(drivers);
  const driverByNameKey = new Map(
    existingDrivers.map((d) => [d.fullName.trim().toLowerCase(), d]),
  );

  const resolvedDrivers = [];
  for (const candidate of seedDrivers) {
    const key = candidate.fullName.trim().toLowerCase();
    let driver = driverByNameKey.get(key);
    if (!driver) {
      const [inserted] = await database.insert(drivers).values(candidate).returning();
      driver = inserted;
      driverByNameKey.set(key, inserted);
    }
    resolvedDrivers.push(driver);
  }

  const [ivanov, smirnov, petrov] = resolvedDrivers;

  const existingRentals = await database.select().from(rentals);
  const seedRentals = [
    {
      carId: kia.id,
      driverId: ivanov.id,
      renterName: ivanov.fullName,
      rateAmount: 2400,
      periodicity: 'weekly' as const,
      startDate: isoDateOffset(baseUtcMs, -24),
      endDate: null,
      active: true,
      managerCommissionPercent: 15,
    },
    {
      carId: hyundai.id,
      driverId: smirnov.id,
      renterName: smirnov.fullName,
      rateAmount: 2100,
      periodicity: 'daily' as const,
      startDate: isoDateOffset(baseUtcMs, -10),
      endDate: null,
      active: true,
      managerCommissionPercent: 10,
    },
    {
      carId: skoda.id,
      driverId: petrov.id,
      renterName: petrov.fullName,
      rateAmount: 2500,
      periodicity: 'weekly' as const,
      startDate: isoDateOffset(baseUtcMs, -45),
      endDate: isoDateOffset(baseUtcMs, -3),
      active: false,
      managerCommissionPercent: 15,
    },
  ];

  for (const seedRental of seedRentals) {
    const alreadyExists = existingRentals.some(
      (r) => r.carId === seedRental.carId && r.active === seedRental.active,
    );
    if (!alreadyExists) {
      await database.insert(rentals).values(seedRental);
    }
  }

  const rentalRows = await database.select().from(rentals);
  const kiaRental = rentalRows.find((r) => r.carId === kia.id && r.active);
  const hyundaiRental = rentalRows.find((r) => r.carId === hyundai.id && r.active);
  const skodaRental = rentalRows.find((r) => r.carId === skoda.id && !r.active);

  const paymentSeeds: Array<{ rentalId: number; dueDate: string; amount: number; paidAt: string | null }> = [];
  if (kiaRental) {
    paymentSeeds.push(
      {
        rentalId: kiaRental.id,
        dueDate: isoDateOffset(baseUtcMs, -24),
        amount: kiaRental.rateAmount,
        paidAt: `${isoDateOffset(baseUtcMs, -24)}T11:30:00Z`,
      },
      {
        rentalId: kiaRental.id,
        dueDate: isoDateOffset(baseUtcMs, -17),
        amount: kiaRental.rateAmount,
        paidAt: `${isoDateOffset(baseUtcMs, -16)}T09:15:00Z`,
      },
    );
  }
  if (hyundaiRental) {
    for (let offset = -10; offset <= -3; offset += 1) {
      paymentSeeds.push({
        rentalId: hyundaiRental.id,
        dueDate: isoDateOffset(baseUtcMs, offset),
        amount: hyundaiRental.rateAmount,
        paidAt: `${isoDateOffset(baseUtcMs, offset)}T18:00:00Z`,
      });
    }
  }
  if (skodaRental) {
    for (const offset of [-45, -38, -31, -24, -17]) {
      paymentSeeds.push({
        rentalId: skodaRental.id,
        dueDate: isoDateOffset(baseUtcMs, offset),
        amount: skodaRental.rateAmount,
        paidAt: `${isoDateOffset(baseUtcMs, offset)}T15:00:00Z`,
      });
    }
  }
  if (paymentSeeds.length > 0) {
    await database
      .insert(rentalPayments)
      .values(paymentSeeds)
      .onConflictDoNothing({ target: [rentalPayments.rentalId, rentalPayments.dueDate] });
  }

  const fineInputs = [
    {
      carId: kia.id,
      resolutionNumber: '18810177261100001001',
      violatedAt: `${isoDateOffset(baseUtcMs, -3)}T14:20:00+03:00`,
      amount: 750,
      discountAmount: 562,
      discountDeadline: isoDateOffset(baseUtcMs, 17),
      paymentDeadline: isoDateOffset(baseUtcMs, 57),
      description: 'Превышение скорости на 20–40 км/ч (ст. 12.9 ч. 2 КоАП)',
      status: 'unpaid' as const,
    },
    {
      carId: kia.id,
      resolutionNumber: '18810177261100001002',
      violatedAt: `${isoDateOffset(baseUtcMs, -12)}T09:45:00+03:00`,
      amount: 3000,
      discountAmount: 2250,
      discountDeadline: isoDateOffset(baseUtcMs, 8),
      paymentDeadline: isoDateOffset(baseUtcMs, 48),
      description: 'Движение по полосе для маршрутных транспортных средств',
      status: 'unpaid' as const,
    },
    {
      carId: kia.id,
      resolutionNumber: '18810177261100001003',
      violatedAt: `${isoDateOffset(baseUtcMs, -28)}T19:10:00+03:00`,
      amount: 1500,
      discountAmount: 1125,
      discountDeadline: isoDateOffset(baseUtcMs, -4),
      paymentDeadline: isoDateOffset(baseUtcMs, 32),
      description: 'Несоблюдение требований дорожных знаков или разметки',
      status: 'unpaid' as const,
    },
    {
      carId: kia.id,
      resolutionNumber: '18810177261100001004',
      violatedAt: `${isoDateOffset(baseUtcMs, -40)}T08:05:00+03:00`,
      amount: 500,
      discountAmount: 375,
      discountDeadline: isoDateOffset(baseUtcMs, -20),
      paymentDeadline: isoDateOffset(baseUtcMs, 20),
      description: 'Нарушение правил применения ремней безопасности',
      status: 'paid' as const,
    },
    {
      carId: hyundai.id,
      resolutionNumber: '18810177261100002001',
      violatedAt: `${isoDateOffset(baseUtcMs, -6)}T16:50:00+03:00`,
      amount: 2500,
      discountAmount: 1875,
      discountDeadline: isoDateOffset(baseUtcMs, 14),
      paymentDeadline: isoDateOffset(baseUtcMs, 54),
      description: 'Проезд на запрещающий сигнал светофора (повторно — нет)',
      status: 'unpaid' as const,
    },
    {
      carId: skoda.id,
      resolutionNumber: '18810177261100003001',
      violatedAt: `${isoDateOffset(baseUtcMs, -30)}T21:12:00+03:00`,
      amount: 5000,
      discountAmount: null,
      discountDeadline: null,
      paymentDeadline: isoDateOffset(baseUtcMs, 30),
      description: 'Парковка на месте для инвалидов / платная парковка (МАДИ)',
      status: 'unpaid' as const,
    },
  ];

  await database
    .insert(fines)
    .values(
      fineInputs.map((fine) => ({
        ...fine,
        driverId: resolveFineDriverId(database, fine.carId, fine.violatedAt),
      })),
    )
    .onConflictDoNothing({ target: fines.resolutionNumber });

  await database
    .insert(carDocuments)
    .values([
      {
        carId: kia.id,
        type: 'osago' as const,
        expiresAt: isoDateOffset(baseUtcMs, 120),
        policyNumber: 'ХХХ 0429182736',
        notes: null,
      },
      {
        carId: kia.id,
        type: 'tech_inspection' as const,
        expiresAt: isoDateOffset(baseUtcMs, 90),
        policyNumber: 'ТО-77-112233',
        notes: null,
      },
      {
        carId: kia.id,
        type: 'taxi_license' as const,
        expiresAt: isoDateOffset(baseUtcMs, 365),
        policyNumber: 'МСК-048291',
        notes: null,
      },
      {
        carId: kia.id,
        type: 'kasko' as const,
        expiresAt: isoDateOffset(baseUtcMs, 60),
        policyNumber: 'КАСКО-99182',
        notes: null,
      },
      {
        carId: hyundai.id,
        type: 'osago' as const,
        expiresAt: isoDateOffset(baseUtcMs, 7),
        policyNumber: 'ТТТ 0918273645',
        notes: 'Продлить на следующей неделе',
      },
      {
        carId: hyundai.id,
        type: 'tech_inspection' as const,
        expiresAt: isoDateOffset(baseUtcMs, 12),
        policyNumber: 'ТО-77-445566',
        notes: null,
      },
      {
        carId: hyundai.id,
        type: 'taxi_license' as const,
        expiresAt: isoDateOffset(baseUtcMs, 200),
        policyNumber: 'МСК-051920',
        notes: null,
      },
      {
        carId: skoda.id,
        type: 'osago' as const,
        expiresAt: isoDateOffset(baseUtcMs, -5),
        policyNumber: 'ААА 0192837465',
        notes: 'Оформить после ремонта',
      },
      {
        carId: skoda.id,
        type: 'tech_inspection' as const,
        expiresAt: isoDateOffset(baseUtcMs, -15),
        policyNumber: 'ТО-77-778899',
        notes: null,
      },
      {
        carId: skoda.id,
        type: 'taxi_license' as const,
        expiresAt: isoDateOffset(baseUtcMs, 5),
        policyNumber: 'МСК-039104',
        notes: null,
      },
      {
        carId: geely.id,
        type: 'osago' as const,
        expiresAt: isoDateOffset(baseUtcMs, 180),
        policyNumber: 'ЕЕЕ 0564738291',
        notes: null,
      },
      {
        carId: geely.id,
        type: 'taxi_license' as const,
        expiresAt: isoDateOffset(baseUtcMs, 300),
        policyNumber: 'МСК-062341',
        notes: null,
      },
    ])
    .onConflictDoNothing({ target: [carDocuments.carId, carDocuments.type] });

  const maintSeedPlan = [
    {
      carId: kia.id,
      records: [
        {
          title: 'ТО-140: замена масла и фильтров',
          performedAt: isoDateOffset(baseUtcMs, -18),
          mileage: 140000,
          laborCost: 2800,
          notes: 'Плановое ТО, проверка ходовой без замечаний',
          parts: [
            { name: 'Масло моторное 5W-30 (4 л)', sku: 'OIL-5W30-4L', quantity: 1, unitPrice: 3600 },
            { name: 'Фильтр масляный', sku: '26300-35505', quantity: 1, unitPrice: 650 },
            { name: 'Расходники и очиститель', sku: null, quantity: 1, unitPrice: 350 },
          ],
        },
      ],
    },
    {
      carId: skoda.id,
      records: [
        {
          title: 'Замена передних тормозных дисков и колодок',
          performedAt: isoDateOffset(baseUtcMs, -2),
          mileage: 215300,
          laborCost: 4500,
          notes: 'Машина на подъёмнике, ожидается проверка сход-развала',
          parts: [
            { name: 'Колодки тормозные передние (к-т)', sku: '5Q0-698-151', quantity: 1, unitPrice: 4200 },
            { name: 'Диск тормозной передний', sku: '1K0-615-301', quantity: 2, unitPrice: 3900 },
          ],
        },
      ],
    },
    {
      carId: geely.id,
      records: [
        {
          title: 'ТО-30: диагностика и замена салонного фильтра',
          performedAt: isoDateOffset(baseUtcMs, -14),
          mileage: 32500,
          laborCost: 1900,
          notes: null,
          parts: [{ name: 'Фильтр салонный угольный', sku: '8022021300', quantity: 1, unitPrice: 1100 }],
        },
      ],
    },
  ];

  for (const plan of maintSeedPlan) {
    const existing = await database
      .select({ id: maintenanceRecords.id })
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.carId, plan.carId))
      .limit(1);
    if (existing.length > 0) continue;

    for (const rec of plan.records) {
      const partsSum = rec.parts.reduce((acc, p) => acc + p.quantity * p.unitPrice, 0);
      const [inserted] = await database
        .insert(maintenanceRecords)
        .values({
          carId: plan.carId,
          title: rec.title,
          performedAt: rec.performedAt,
          mileage: rec.mileage,
          laborCost: rec.laborCost,
          totalCost: rec.laborCost + partsSum,
          notes: rec.notes,
        })
        .returning({ id: maintenanceRecords.id });

      if (rec.parts.length > 0) {
        await database.insert(maintenanceParts).values(
          rec.parts.map((p) => ({
            recordId: inserted.id,
            name: p.name,
            sku: p.sku,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
          })),
        );
      }
    }
  }
}

const isDirectRun =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  typeof import.meta?.url === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  import('./index')
    .then(({ db }) => seedDatabase(db))
    .then(() => {
      console.log('Database seeded successfully.');
    })
    .catch((err) => {
      console.error('Failed to seed database:', err);
      process.exit(1);
    });
}
