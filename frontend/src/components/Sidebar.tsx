'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Clapperboard, ShoppingCart, Users, ClipboardList,
  BarChart2, ChevronRight, LogOut, CreditCard,
  Banknote, BookOpen, Upload, ShieldCheck, Truck,
  HeartPulse, Archive,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const ALL_ROLES: ('managing_director' | 'construction_accountant' | 'construction_coordinator')[] = [
  'managing_director',
  'construction_accountant',
  'construction_coordinator',
];

const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      { href: '/dashboard',   label: 'Dashboard',   icon: LayoutDashboard, roles: ALL_ROLES },
      { href: '/overview',    label: 'Overview',    icon: LayoutDashboard, roles: ALL_ROLES },
      { href: '/productions', label: 'Productions', icon: Clapperboard,    roles: ALL_ROLES },
      { href: '/assets-hire', label: 'Assets & Hire', icon: Truck,          roles: ALL_ROLES },
      { href: '/safety-health', label: 'Health & Safety', icon: HeartPulse, roles: ALL_ROLES },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/purchase-orders',    label: 'Purchase Orders',   icon: ShoppingCart, roles: ALL_ROLES },
      { href: '/cost-report',        label: 'Cost Report',       icon: BarChart2,    roles: ALL_ROLES },
      { href: '/historical-cost-reports', label: 'Finance', icon: Archive, roles: ALL_ROLES },
      { href: '/pay-runs',           label: 'Pay Runs',          icon: Banknote,     roles: ALL_ROLES },
      { href: '/materials-catalogue', label: 'Materials Catalogue',icon: BookOpen,     roles: ALL_ROLES },
      { href: '/suppliers',          label: 'Supplier Database', icon: BookOpen,     roles: ALL_ROLES },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/crew',        label: 'Crew Database', icon: Users,        roles: ALL_ROLES },
      { href: '/crew/import', label: 'Crew Import',   icon: Upload,       roles: ALL_ROLES },
      { href: '/timesheets',  label: 'Timesheets',    icon: ClipboardList, roles: ALL_ROLES },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings/rate-card', label: 'Rate Card',        icon: CreditCard,   roles: ALL_ROLES },
      { href: '/settings/users',     label: 'User Accounts',    icon: ShieldCheck,  roles: ['managing_director'] },
    ],
  },
];

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function getRoleLabel(role: string) {
  if (role === 'managing_director')       return 'Managing Director';
  if (role === 'construction_accountant') return 'Construction Accountant';
  if (role === 'construction_coordinator') return 'Construction Coordinator';
  return role;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

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
    <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 bg-slate-900 flex-col z-30">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-700/60">
        <img src="/construct scenery logo.png" alt="Construct Scenery Database" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
        <div>
          <p className="text-white font-bold text-sm leading-tight">Construct Scenery</p>
          <p className="text-blue-400 text-[10px] leading-tight tracking-wider uppercase">Database</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-4">
        {visibleGroups.map(group => (
          <div key={group.label}>
            <p className="text-slate-500 text-[10px] uppercase tracking-widest font-semibold px-3 pb-1.5">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = href === activeHref;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                      active
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon size={17} className="flex-shrink-0" />
                    <span className="flex-1 truncate">{label}</span>
                    {active && <ChevronRight size={14} className="opacity-70" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User + Logout */}
      <div className="px-4 py-4 border-t border-slate-700/60 space-y-2">
        <div className="flex items-center gap-3">
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
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white text-xs font-medium transition-all"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
