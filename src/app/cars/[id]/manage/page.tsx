import { notFound, redirect } from 'next/navigation';
import { CarManageClient } from '@/components/CarManageClient';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/auth/session';
import { getCarDetail } from '@/lib/cars';
import { listDriverSummaries } from '@/lib/drivers';
import { listOwners } from '@/lib/users';
import { parsePositiveIntId } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Server-guarded admin page for managing car details, documents, maintenance, rental, and fines. */
export default async function ManageCarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'admin') {
    redirect('/');
  }

  const { id } = await params;
  const carId = parsePositiveIntId(id);
  if (carId === null) {
    notFound();
  }

  const car = await getCarDetail(db, carId);
  if (!car) {
    notFound();
  }

  const [drivers, owners] = await Promise.all([
    listDriverSummaries(db),
    listOwners(db),
  ]);

  return <CarManageClient car={car} drivers={drivers} owners={owners} />;
}
