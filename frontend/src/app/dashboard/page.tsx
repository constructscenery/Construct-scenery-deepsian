'use client';

import RequireRole from '@/components/RequireRole';
import MDDashboard from './MDDashboard';

// Warren's Dashboard — exclusive to the Managing Director. Accountant and
// Coordinator land on /overview instead (see app/overview/page.tsx).
export default function DashboardPage() {
  return (
    <RequireRole roles={['managing_director', 'construction_accountant', 'construction_coordinator', 'guest']}>
      <MDDashboard />
    </RequireRole>
  );
}
