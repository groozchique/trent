import { redirect } from 'next/navigation';
import { UsersClient } from '@/components/UsersClient';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/auth/session';
import { listUsersSafe } from '@/lib/users';

export const dynamic = 'force-dynamic';

/** Server-guarded admin-only page for managing system user accounts. */
export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'admin') {
    redirect('/');
  }

  const users = await listUsersSafe(db);

  return <UsersClient initialUsers={users} currentUserId={user.id} />;
}
