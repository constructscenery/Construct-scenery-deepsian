'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Clapperboard, ShoppingCart, Users,
  ClipboardList, BarChart2, TrendingUp, MoreHorizontal, X, LogOut, Upload, Archive,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type NavItem = { href: string; label: string; icon: React.ElementType };

// 3 primary tabs per role
const PRIMARY: Record<string, NavItem[]> = {
  managing_director: [
    { href: '/dashboard',       label: 'Dashboard',   icon: LayoutDashboard },
    { href: '/productions',     label: 'Productions', icon: Clapperboard },
    { href: '/purchase-orders', label: 'Orders',      icon: ShoppingCart },
  ],
  construction_accountant: [
    { href: '/overview',        label: 'Overview',    icon: LayoutDashboard },
    { href: '/timesheets',      label: 'Timesheets',  icon: ClipboardList },
    { href: '/purchase-orders', label: 'Orders',      icon: ShoppingCart },
  ],
  construction_coordinator: [
    { href: '/overview',        label: 'Overview',    icon: LayoutDashboard },
    { href: '/productions',     label: 'Productions', icon: Clapperboard },
    { href: '/purchase-orders', label: 'Orders',      icon: ShoppingCart },
  ],
};

const FULL_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',       label: 'Dashboard',          icon: LayoutDashboard },
  { href: '/productions',     label: 'Productions',        icon: Clapperboard },
  { href: '/purchase-orders', label: 'Purchase Orders',    icon: ShoppingCart },
  { href: '/cost-report',     label: 'Live Cost Report',   icon: BarChart2 },
  { href: '/historical-cost-reports', label: 'Report Archive', icon: Archive },
  { href: '/forecasting',     label: 'Forecasting',        icon: TrendingUp },
  { href: '/crew',            label: 'Crew',               icon: Users },
  { href: '/timesheets',      label: 'Timesheets',         icon: ClipboardList },
];

// All items per role (for "More" drawer)
const ALL_ITEMS: Record<string, NavItem[]> = {
  managing_director: FULL_NAV_ITEMS,
  construction_accountant: FULL_NAV_ITEMS,
  construction_coordinator: FULL_NAV_ITEMS,
  guest: FULL_NAV_ITEMS,
};

function getRoleLabel(role: string) {
  if (role === 'managing_director')        return 'Managing Director';
  if (role === 'construction_accountant')  return 'Construction Accountant';
  if (role === 'construction_coordinator') return 'Construction Coordinator';
  if (role === 'guest')                    return 'Guest (Read Only)';
  return role;
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

export default function BottomNav() {
  const pathname    = usePathname();
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const role     = user?.role ?? 'managing_director';
  const primary  = PRIMARY[role]  ?? PRIMARY.managing_director;
  const allItems = ALL_ITEMS[role] ?? ALL_ITEMS.managing_director;

  // Nested routes (e.g. /crew and /crew/import) can both prefix-match the current
  // pathname — only the longest (most specific) match in a given list should be active.
  const bestMatch = (items: NavItem[]) =>
    items
      .map(i => i.href)
      .filter(href => pathname === href || pathname.startsWith(href + '/'))
      .sort((a, b) => b.length - a.length)[0];

  const activePrimaryHref = bestMatch(primary);
  const activeDrawerHref  = bestMatch(allItems);

  return (
    <>
      {/* Bottom nav bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900 border-t border-slate-700/60 flex items-center safe-area-bottom">
        {primary.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] transition-colors ${
              href === activePrimaryHref ? 'text-blue-400' : 'text-slate-400'
            }`}
          >
            <Icon size={20} />
            <span className="text-xs font-normal leading-tight">{label}</span>
          </Link>
        ))}
        {/* More button */}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] transition-colors ${
            moreOpen ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <MoreHorizontal size={20} />
          <span className="text-xs font-normal leading-tight">More</span>
        </button>
      </nav>

      {/* Full-screen "More" drawer */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-slate-900 flex flex-col">
          {/* Drawer header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-normal">
                  {user ? getInitials(user.full_name) : '?'}
                </span>
              </div>
              <div>
                <p className="text-white text-xs font-normal">{user?.full_name ?? '—'}</p>
                <p className="text-slate-400 text-xs font-normal">{user ? getRoleLabel(user.role) : ''}</p>
              </div>
            </div>
            <button
              onClick={() => setMoreOpen(false)}
              className="p-2 text-slate-400 hover:text-white rounded-lg"
            >
              <X size={20} />
            </button>
          </div>

          {/* All nav items */}
          <nav className="flex-1 px-4 py-4 overflow-y-auto space-y-1">
            {allItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                className={`flex items-center gap-4 px-4 py-3 rounded-xl text-xs font-normal transition-colors min-h-[48px] ${
                  href === activeDrawerHref
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={18} className="flex-shrink-0" />
                {label}
              </Link>
            ))}
          </nav>

          {/* Sign out */}
          <div className="px-4 py-4 border-t border-slate-700/60">
            <button
              onClick={() => { setMoreOpen(false); logout(); }}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-xs font-normal text-slate-400 hover:bg-slate-800 hover:text-white transition-colors min-h-[48px]"
            >
              <LogOut size={18} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
