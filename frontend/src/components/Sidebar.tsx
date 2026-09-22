'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Clapperboard, ShoppingCart, Users, ClipboardList,
  BarChart2, ChevronRight, LogOut, CreditCard,
  Banknote, Upload, ShieldCheck, Truck,
  HeartPulse, Archive, Building2, Package, TrendingUp, History,
  Layers, Users2, ShoppingBag, SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUIPreferences } from '@/contexts/UIPreferencesContext';
import { UserRole } from '@/lib/api';

const ALL_ROLES: UserRole[] = [
  'managing_director',
  'construction_accountant',
  'construction_coordinator',
  'guest',
];

const NAV_GROUPS = [
  {
    label: 'Operations',
    icon: Layers,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ALL_ROLES },
      { href: '/productions', label: 'Productions', icon: Clapperboard, roles: ALL_ROLES },
      { href: '/assets-hire', label: 'Assets & Hire', icon: Truck, roles: ALL_ROLES },
      { href: '/safety-health', label: 'Health & Safety', icon: HeartPulse, roles: ALL_ROLES },
    ],
  },
  {
    label: 'People & Payroll',
    icon: Users2,
    items: [
      { href: '/crew', label: 'Crew', icon: Users, roles: ALL_ROLES },
      { href: '/timesheets', label: 'Timesheets', icon: ClipboardList, roles: ALL_ROLES },
      { href: '/pay-runs', label: 'Pay Runs', icon: Banknote, roles: ALL_ROLES },
    ],
  },
  {
    label: 'Purchasing',
    icon: ShoppingBag,
    items: [
      { href: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, roles: ALL_ROLES },
      { href: '/suppliers', label: 'Suppliers', icon: Building2, roles: ALL_ROLES },
      { href: '/materials-catalogue', label: 'Materials & Stock', icon: Package, roles: ALL_ROLES },
    ],
  },
  {
    label: 'Planning & Finance',
    icon: TrendingUp,
    items: [
      { href: '/cost-report', label: 'Live Cost Report', icon: BarChart2, roles: ALL_ROLES },
      { href: '/historical-cost-reports', label: 'Report Archive', icon: Archive, roles: ALL_ROLES },
    ],
  },
  {
    label: 'Administration',
    icon: SlidersHorizontal,
    items: [
      { href: '/settings/rate-card', label: 'Rate Cards', icon: CreditCard, roles: ALL_ROLES },
      { href: '/settings/users', label: 'Users & Roles', icon: ShieldCheck, roles: ['managing_director'] as UserRole[] },
      { href: '/audit-log', label: 'Audit Log', icon: History, roles: ALL_ROLES },
    ],
  },
];

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function getRoleLabel(role: string) {
  if (role === 'managing_director') return 'Managing Director';
  if (role === 'construction_accountant') return 'Construction Accountant';
  if (role === 'construction_coordinator') return 'Construction Coordinator';
  if (role === 'guest') return 'Guest (Read Only)';
  return role;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { sidebarIcons } = useUIPreferences();

  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => !user || item.roles.includes(user.role)),
  })).filter(group => group.items.length > 0);

  // Nested routes (e.g. /settings and /settings/users) can both prefix-match the
  // current pathname — only the longest (most specific) match should be highlighted.
  const matchingHrefs = visibleGroups
    .flatMap(group => group.items.map(item => item.href))
    .filter(href => pathname === href || pathname.startsWith(href + '/'));
  const activeHref = matchingHrefs.sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 bg-slate-900 border-r border-slate-800/80 flex-col z-30">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-slate-700/60">
        <img src="/construct scenery logo.png" alt="Construct Scenery Database" className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />
        <div>
          <p className="text-white font-bold text-[13px] leading-tight">Construct Scenery</p>
          <p className="text-blue-400 text-[9px] leading-tight tracking-wider uppercase">Database</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 flex flex-col justify-between overflow-y-auto">
        {visibleGroups.map(group => {
          const GroupIcon = group.icon;
          return (
            <div key={group.label} className="mb-2 last:mb-0">
              {/* Heading: reversed to larger 13px size, still uppercase */}
              <div className="flex items-center gap-1.5 px-2.5 pb-1.5 text-slate-300 font-semibold text-[13px] uppercase tracking-wider">
                {sidebarIcons && GroupIcon && (
                  <GroupIcon size={14} className="text-slate-400 flex-shrink-0" />
                )}
                <span className="truncate">{group.label}</span>
              </div>

              {/* Sub tabs / options items: reversed to smaller 10px size, lowercase */}
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = href === activeHref;
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-medium lowercase transition-all duration-150 ${active
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}
                    >
                      {sidebarIcons && (
                        <Icon size={13} className="flex-shrink-0" />
                      )}
                      <span className="flex-1 truncate">{label.toLowerCase()}</span>
                      {active && <ChevronRight size={11} className="opacity-70 flex-shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-4 py-3 border-t border-slate-700/60 space-y-1.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">
              {user ? getInitials(user.full_name) : '?'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-xs font-semibold truncate">{user?.full_name ?? '—'}</p>
            <p className="text-slate-400 text-[10px] truncate">{user ? getRoleLabel(user.role) : ''}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white text-xs font-medium transition-all"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
