'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/lib/api';

type Role = UserRole;

/**
 * Frontend route guard. Wrap any page's content with this to enforce that
 * only the listed roles can view it — mirrors the backend's requireRole()
 * middleware so a forbidden role can never navigate directly to a URL and
 * see the page, even though the matching API calls would also 403.
 *
 * Usage:
 *   export default function DashboardPage() {
 *     return (
 *       <RequireRole roles={['managing_director']}>
 *         <MDDashboard />
 *       </RequireRole>
 *     );
 *   }
 */
export default function RequireRole({
  roles,
  redirectTo = '/productions',
  children,
}: {
  roles: Role[];
  redirectTo?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();

  const allowed = !!user && roles.includes(user.role);

  useEffect(() => {
    if (!loading && user && !allowed) {
      router.replace(redirectTo);
    }
  }, [loading, user, allowed, router, redirectTo]);

  if (loading || !user) return null;
  if (!allowed) return null;

  return <>{children}</>;
}
