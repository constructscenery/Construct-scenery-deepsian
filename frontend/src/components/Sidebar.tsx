'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Clapperboard, ShoppingCart, Users, ClipboardList,
  BarChart2, ChevronRight, ChevronLeft, LogOut, CreditCard,
  Banknote, ShieldCheck, Truck,
  HeartPulse, Archive, Building2, Package, TrendingUp, History,
  Layers, Users2, ShoppingBag, SlidersHorizontal, ChevronsLeft, ChevronsRight,
  PanelLeftClose, PanelLeftOpen, LineChart, FileText, Mail, Receipt, ScrollText, PoundSterling,
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
    key: 'operations',
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
    key: 'people',
    label: 'People & Payroll',
    icon: Users2,
    items: [
      { href: '/crew', label: 'Crew', icon: Users, roles: ALL_ROLES },
      { href: '/unit-lists', label: 'Unit Lists', icon: FileText, roles: ALL_ROLES },
      { href: '/timesheets', label: 'Timesheets', icon: ClipboardList, roles: ALL_ROLES },
      { href: '/pay-runs', label: 'Pay Runs', icon: Banknote, roles: ALL_ROLES },
      { href: '/emailing', label: 'Emailing', icon: Mail, roles: ALL_ROLES },
    ],
  },
  {
    key: 'purchasing',
    label: 'Purchasing',
    icon: ShoppingBag,
    items: [
      { href: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, roles: ALL_ROLES },
      { href: '/suppliers', label: 'Suppliers', icon: Building2, roles: ALL_ROLES },
      { href: '/materials-catalogue', label: 'Materials & Stock', icon: Package, roles: ALL_ROLES },
    ],
  },
  {
    key: 'sales',
    label: 'Sales & Quotes',
    icon: PoundSterling,
    items: [
      { href: '/sales', label: 'Sales', icon: Receipt, roles: ALL_ROLES },
      { href: '/quotes', label: 'Quotes', icon: ScrollText, roles: ALL_ROLES },
    ],
  },
  {
    key: 'planning',
    label: 'Planning & Finance',
    icon: TrendingUp,
    items: [
      { href: '/forecasting', label: 'Forecasting', icon: LineChart, roles: ALL_ROLES },
      { href: '/cost-report', label: 'Live Cost Report', icon: BarChart2, roles: ALL_ROLES },
      { href: '/historical-cost-reports', label: 'Report Archive', icon: Archive, roles: ALL_ROLES },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    icon: SlidersHorizontal,
    items: [
      { href: '/settings/rate-card', label: 'Rate Cards', icon: CreditCard, roles: ALL_ROLES },
      { href: '/settings/users', label: 'Users & Roles', icon: ShieldCheck, roles: ['managing_director'] as UserRole[] },
      { href: '/audit-log', label: 'Audit Log', icon: History, roles: ALL_ROLES },
    ],
  },
];

function getInitials(name?: string | null) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function getRoleLabel(role: string) {
  if (role === 'managing_director') return 'Managing Director';
  if (role === 'construction_accountant') return 'Accountant';
  if (role === 'construction_coordinator') return 'Coordinator';
  if (role === 'guest') return 'Guest (Read Only)';
  return role;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const {
    sidebarIcons,
    flap1Open,
    flap2Open,
    toggleFlap1,
    toggleFlap2,
    setFlap1Open,
    setFlap2Open,
  } = useUIPreferences();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !user || item.roles.includes(user.role)),
  })).filter((group) => group.items.length > 0);

  // Nested routes check: longest match wins
  const matchingHrefs = visibleGroups
    .flatMap((group) => group.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(href + '/'));
  const activeHref = matchingHrefs.sort((a, b) => b.length - a.length)[0];

  // Active group key for highlighting group icons on Flap 1
  const activeGroup = visibleGroups.find((g) =>
    g.items.some((item) => item.href === activeHref)
  );

  return (
    <>
      {/* ─── FLOATING RE-OPEN TRIGGER (Visible when Flap 1 is completely closed) ─── */}
      {!flap1Open && (
        <button
          onClick={() => setFlap1Open(true)}
          className="cms-sidebar hidden md:flex fixed top-3 left-3 z-40 items-center gap-1.5 px-3 py-2 rounded-xl bg-[#302824] dark:bg-slate-900/95 hover:bg-[#69466F] dark:hover:bg-blue-600 text-[#E8E1DB] border border-[#443833] dark:border-blue-500/40 shadow-xl transition-all duration-200 group cursor-pointer"
          title="Open Sidebar (Flap 1 & Flap 2)"
          aria-label="Open Sidebar"
        >
          <img
            src="/theoffice_logo_square.png"
            alt=""
            className="w-5 h-5 rounded-full object-contain flex-shrink-0"
          />
          <ChevronsRight size={14} className="text-[#C9C5BF] group-hover:text-white transition-colors" />
          <span className="text-xs font-semibold tracking-wider uppercase">Open</span>
        </button>
      )}

      {/* ─── FLAP 1: SLIM ICON RAIL (Width: 68px) ─── */}
      <aside
        className={`cms-sidebar hidden md:flex fixed inset-y-0 left-0 w-[68px] bg-[#302824] dark:bg-[#061327] border-r border-[#443833] dark:border-slate-800/80 flex-col justify-between items-center py-3 z-35 transition-transform duration-300 ease-in-out select-none ${flap1Open ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        {/* Top: Logo & Flap 2 Toggle */}
        <div className="flex flex-col items-center gap-3 w-full px-2">
          {/* Logo Button — clicking toggles Flap 2 */}
          <button
            onClick={toggleFlap2}
            className="w-11 h-11 rounded-xl bg-[#443833]/70 dark:bg-gradient-to-b dark:from-[#0c2854] dark:to-[#071935] border border-transparent p-1 flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 group relative cursor-pointer"
            title={flap2Open ? 'Collapse Navigation (Flap 2)' : 'Expand Navigation (Flap 2)'}
            aria-label="Toggle navigation drawer"
          >
            <img
              src="/theoffice_logo_square.png"
              alt="TheOffice"
              className="w-8 h-8 object-contain rounded-full"
            />
            {/* Small status dot indicating flap 2 open/closed */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#302824] dark:border-[#061327] ${flap2Open ? 'bg-[#69466F] dark:bg-blue-500' : 'bg-slate-500'
                }`}
            />
          </button>
        </div>

        {/* Middle placeholder to push bottom controls down */}
        <div className="flex-1" />

        {/* Bottom Controls: User profile & Flap Collapse buttons */}
        <div className="flex flex-col items-center gap-2 w-full px-2 pt-2 border-t border-[#443833] dark:border-slate-800/60">
          {/* Flap 2 Collapse / Expand Button */}
          <button
            onClick={toggleFlap2}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${flap2Open
              ? 'text-[#C9C5BF] hover:text-white hover:bg-[#443833] dark:text-slate-400 dark:hover:bg-slate-800'
              : 'text-white bg-[#69466F] border border-[#69466F] hover:bg-[#55385B] dark:text-blue-400 dark:bg-blue-950/60 dark:border-blue-500/40 dark:hover:bg-blue-900/60'
              }`}
            title={flap2Open ? 'Close Flap 2 (Menu Drawer)' : 'Open Flap 2 (Menu Drawer)'}
            aria-label="Toggle Flap 2"
          >
            {flap2Open ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>

          {/* User Profile Avatar */}
          {!flap2Open && (
            <div
              className="w-8 h-8 rounded-full bg-[#69466F] dark:bg-blue-600 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold shadow-md cursor-pointer hover:ring-2 hover:ring-[#E8E1DB] dark:hover:ring-blue-400 transition-all"
              title={`${user?.full_name || 'User'} (${user ? getRoleLabel(user.role) : ''})`}
            >
              {user ? getInitials(user.full_name) : '?'}
            </div>
          )}

          {/* Flap 1 Collapse (Closes Entire Sidebar) */}
          <button
            onClick={toggleFlap1}
            className="w-9 h-9 rounded-lg text-[#C9C5BF] hover:text-white hover:bg-[#443833] dark:text-slate-400 dark:hover:text-amber-400 dark:hover:bg-slate-800/80 flex items-center justify-center transition-colors cursor-pointer"
            title="Close Flap 1 (Full screen view)"
            aria-label="Close Flap 1"
          >
            <ChevronsLeft size={16} />
          </button>
        </div>
      </aside>

      {/* ─── FLAP 2: NAVIGATION DRAWER (Width: 224px, positioned next to Flap 1) ─── */}
      <aside
        className={`cms-sidebar hidden md:flex fixed inset-y-0 left-[68px] w-56 bg-[#302824] dark:bg-gradient-to-b dark:from-[#07172f] dark:via-[#091f3f] dark:to-[#06152b] border-r border-[#443833] dark:border-slate-800/80 flex-col z-30 transition-all duration-300 ease-in-out select-none ${flap1Open && flap2Open
          ? 'translate-x-0 opacity-100'
          : '-translate-x-12 opacity-0 pointer-events-none'
          }`}
      >
        {/* Header: TheOffice. Brand Card */}
        <div className="p-3 border-b border-[#443833] dark:border-blue-900/40">
          <div className="relative rounded-xl bg-[#443833]/40 dark:bg-[#092247]/90 border border-transparent p-2.5 flex items-center justify-between">
            <img
              src="/theoffice_logo_wide.png"
              alt="TheOffice — Construct Scenery Limited"
              className="h-11 w-auto max-w-[calc(100%-1.75rem)] object-contain rounded-full"
            />

            {/* Close Flap 2 button */}
            <button
              onClick={() => setFlap2Open(false)}
              className="p-1 rounded-md text-[#C9C5BF] hover:text-white hover:bg-[#443833] dark:text-blue-300/70 dark:hover:bg-blue-600/30 transition-colors cursor-pointer"
              title="Close Flap 2"
              aria-label="Close Flap 2"
            >
              <ChevronLeft size={15} />
            </button>
          </div>
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 px-2.5 py-3 flex flex-col justify-start gap-4 overflow-y-auto custom-scrollbar">
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;

            return (
              <div key={group.key} className="space-y-1 mb-2 last:mb-0">
                {/* Section Header */}
                <div className="cms-sidebar-label flex items-center gap-1.5 px-3 pb-1 text-[#C9C5BF] dark:text-slate-500 font-semibold text-xs uppercase tracking-widest">
                  {sidebarIcons && GroupIcon && (
                    <GroupIcon size={12} className="text-[#C9C5BF] dark:text-slate-400 flex-shrink-0" />
                  )}
                  <span className="truncate">{group.label}</span>
                </div>

                {/* Sub items */}
                <div className="space-y-0.5">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const active = href === activeHref;

                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={`cms-nav-link group flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-all duration-150 ${active
                          ? 'bg-[#69466F] text-white dark:bg-blue-600 dark:shadow-[0_2px_12px_rgba(37,99,235,0.45)]'
                          : 'text-[#E8E1DB] hover:bg-[#443833] hover:text-white dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                          }`}
                      >
                        {sidebarIcons && Icon && (
                          <Icon size={13} className="flex-shrink-0" />
                        )}
                        <span className="flex-1 truncate">{label}</span>
                        {active && <ChevronRight size={11} className="opacity-70 flex-shrink-0" />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom Bar: User & Logout */}
        <div className="p-3 border-t border-[#443833] dark:border-blue-900/40 space-y-2 bg-[#251E1B]/70 dark:bg-[#051122]/70">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#69466F] dark:bg-blue-600 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
              {user ? getInitials(user.full_name) : '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate">{user?.full_name || user?.email || '—'}</p>
              <p className="text-[#C9C5BF] dark:text-slate-400 text-xs truncate">{user ? getRoleLabel(user.role) : ''}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[#C9C5BF] hover:bg-[#443833] hover:text-white dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white text-xs font-medium transition-all cursor-pointer"
          >
            <LogOut size={13} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
