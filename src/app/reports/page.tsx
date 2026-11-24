import { asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { ReportsClient } from '@/components/ReportsClient';
import { db } from '@/db';
import { cars } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { getTodayIso } from '@/lib/cars';
import { buildReport, getIsoWeekRange } from '@/lib/reports';
import { listOwners } from '@/lib/users';

export const dynamic = 'force-dynamic';

/** Server-guarded financial reports page accessible to viewer and admin roles. */
export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  if (user.role === 'owner') {
    redirect('/');
  }

  const todayIso = getTodayIso();
  const weekRange = getIsoWeekRange(todayIso);

  const [carOptions, owners, initialReport] = await Promise.all([
    db
      .select({
        id: cars.id,
        plate: cars.plate,
        brand: cars.brand,
        model: cars.model,
      })
      .from(cars)
      .orderBy(asc(cars.id)),
    listOwners(db),
    buildReport(db, {
      type: 'weekly',
      periodStart: weekRange.start,
      periodEnd: weekRange.end,
      carId: null,
      ownerId: null,
      includeFinancial: true,
      includeMaintenance: false,
    }),
  ]);

  return (
    <ReportsClient
      initialReport={initialReport}
      cars={carOptions}
      owners={owners}
      initialDate={todayIso}
      initialMonth={todayIso.slice(0, 7)}
      initialYear={todayIso.slice(0, 4)}
    />
  );
}
