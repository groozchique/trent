import { redirect } from 'next/navigation';
import { DriversClient } from '@/components/DriversClient';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/auth/session';
import { listDriverSummaries } from '@/lib/drivers';

export const dynamic = 'force-dynamic';

/** Server-guarded drivers directory page accessible to viewer and admin roles. */
export default async function DriversPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  if (user.role === 'owner') {
    redirect('/');
  }

  const drivers = await listDriverSummaries(db);

  return <DriversClient initialDrivers={drivers} userRole={user.role} />;
}
