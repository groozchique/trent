import { redirect } from 'next/navigation';
import { DashboardClient } from '@/components/DashboardClient';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/auth/session';
import { listCarSummariesWithSummary } from '@/lib/cars';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { cars, summary } = await listCarSummariesWithSummary(db);

  return <DashboardClient initialCars={cars} initialSummary={summary} userRole={user.role} />;
}
