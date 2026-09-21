'use client';

import { useAuth } from '@/contexts/AuthContext';
import RequireRole from '@/components/RequireRole';
import AccountantDashboard from '../dashboard/AccountantDashboard';
import CoordinatorDashboard from '../dashboard/CoordinatorDashboard';

// Landing page for Accountant and Coordinator. Warren's Dashboard (/dashboard)
// is reserved exclusively for the Managing Director.
function OverviewContent() {
  const { user } = useAuth();
  if (user?.role === 'construction_accountant')  return <AccountantDashboard />;
  if (user?.role === 'construction_coordinator') return <CoordinatorDashboard />;
  if (user?.role === 'managing_director')        return <AccountantDashboard />;
  if (user?.role === 'guest')                    return <AccountantDashboard />;
  return null;
}

export default function OverviewPage() {
  return (
    <RequireRole roles={['managing_director', 'construction_accountant', 'construction_coordinator', 'guest']}>
      <OverviewContent />
    </RequireRole>
  );
}
