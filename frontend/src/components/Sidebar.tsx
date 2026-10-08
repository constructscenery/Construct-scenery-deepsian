'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Clapperboard, ShoppingCart, Users, ClipboardList,
  BarChart2, ChevronRight, ChevronLeft, LogOut, CreditCard,
  Banknote, ShieldCheck, Truck,
  HeartPulse, Archive, Building2, Package, TrendingUp, History,
  Layers, Users2, ShoppingBag, SlidersHorizontal, ChevronsLeft, ChevronsRight,
  PanelLeftClose, PanelLeftOpen, LineChart, FileText, Mail,
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
          className="hidden md:flex fixed top-3 left-3 z-40 items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/95 hover:bg-blue-600 text-white border border-blue-500/40 shadow-xl transition-all duration-200 group cursor-pointer"
          title="Open Sidebar (Flap 1 & Flap 2)"
          aria-label="Open Sidebar"
        >
          <img
            src="/the_office_chair_square.png"
            alt=""
            className="w-5 h-5 rounded object-cover flex-shrink-0"
          />
          <ChevronsRight size={14} className="text-blue-400 group-hover:text-white transition-colors" />
          <span className="text-[11px] font-semibold tracking-wider uppercase">Open</span>
        </button>
      )}

      {/* ─── FLAP 1: SLIM ICON RAIL (Width: 68px) ─── */}
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 w-[68px] bg-[#061327] border-r border-slate-800/80 flex-col justify-between items-center py-3 z-35 transition-transform duration-300 ease-in-out select-none ${flap1Open ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        {/* Top: Logo & Flap 2 Toggle */}
        <div className="flex flex-col items-center gap-3 w-full px-2">
          {/* Logo Button — clicking toggles Flap 2 */}
          <button
            onClick={toggleFlap2}
            className="w-11 h-11 rounded-xl bg-gradient-to-b from-[#0c2854] to-[#071935] border border-blue-500/60 hover:border-blue-400 p-1 flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 group relative cursor-pointer"
            title={flap2Open ? 'Collapse Navigation (Flap 2)' : 'Expand Navigation (Flap 2)'}
            aria-label="Toggle navigation drawer"
          >
            <img
              src="/the_office_chair_square.png"
              alt="TheOffice."
              className="w-7 h-7 object-contain rounded"
            />
            {/* Small status dot indicating flap 2 open/closed */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#061327] ${flap2Open ? 'bg-blue-500' : 'bg-slate-500'
                }`}
            />
          </button>
        </div>

        {/* Middle placeholder to push bottom controls down */}
        <div className="flex-1" />

        {/* Bottom Controls: User profile & Flap Collapse buttons */}
        <div className="flex flex-col items-center gap-2 w-full px-2 pt-2 border-t border-slate-800/60">
          {/* Flap 2 Collapse / Expand Button */}
          <button
            onClick={toggleFlap2}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${flap2Open
              ? 'text-slate-400 hover:text-white hover:bg-slate-800'
              : 'text-blue-400 bg-blue-950/60 border border-blue-500/40 hover:bg-blue-900/60'
              }`}
            title={flap2Open ? 'Close Flap 2 (Menu Drawer)' : 'Open Flap 2 (Menu Drawer)'}
            aria-label="Toggle Flap 2"
          >
            {flap2Open ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>

          {/* User Profile Avatar */}
          {!flap2Open && (
            <div
              className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 text-white text-[11px] font-bold shadow-md cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
              title={`${user?.full_name || 'User'} (${user ? getRoleLabel(user.role) : ''})`}
            >
              {user ? getInitials(user.full_name) : '?'}
            </div>
          )}

          {/* Flap 1 Collapse (Closes Entire Sidebar) */}
          <button
            onClick={toggleFlap1}
            className="w-9 h-9 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800/80 flex items-center justify-center transition-colors cursor-pointer"
            title="Close Flap 1 (Full screen view)"
            aria-label="Close Flap 1"
          >
            <ChevronsLeft size={16} />
          </button>
        </div>
      </aside>

      {/* ─── FLAP 2: NAVIGATION DRAWER (Width: 224px, positioned next to Flap 1) ─── */}
      <aside
        className={`hidden md:flex fixed inset-y-0 left-[68px] w-56 bg-gradient-to-b from-[#07172f] via-[#091f3f] to-[#06152b] border-r border-slate-800/80 flex-col z-30 transition-all duration-300 ease-in-out select-none ${flap1Open && flap2Open
          ? 'translate-x-0 opacity-100'
          : '-translate-x-12 opacity-0 pointer-events-none'
          }`}
      >
        {/* Header: TheOffice. Brand Card matching office.png */}
        <div className="p-3 border-b border-blue-900/40">
          <div className="relative rounded-xl bg-[#092247]/90 border border-blue-500/80 shadow-[0_0_15px_rgba(37,99,235,0.25)] p-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="/the_office_chair_square.png"
                alt="Director's Chair"
                className="w-6 h-6 object-contain flex-shrink-0 rounded"
              />
              <span className="text-white font-bold text-sm tracking-tight truncate">
                TheOffice<span className="text-blue-500">.</span>
              </span>
            </div>

            {/* Close Flap 2 button */}
            <button
              onClick={() => setFlap2Open(false)}
              className="p-1 rounded-md text-blue-300/70 hover:text-white hover:bg-blue-600/30 transition-colors cursor-pointer"
              title="Close Flap 2"
              aria-label="Close Flap 2"
            >
              <ChevronLeft size={15} />
            </button>
          </div>
        </div>

        {/* Navigation Groups matching office.png */}
        <nav className="flex-1 px-2.5 py-3 flex flex-col justify-start gap-4 overflow-y-auto custom-scrollbar">
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;

            return (
              <div key={group.key} className="space-y-1 mb-2 last:mb-0">
                {/* Section Header */}
                <div className="flex items-center gap-1.5 px-3 pb-1 text-slate-500 font-semibold text-[10px] uppercase tracking-widest">
                  {sidebarIcons && GroupIcon && (
                    <GroupIcon size={12} className="text-slate-400 flex-shrink-0" />
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
                        className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-medium uppercase tracking-wider transition-all duration-150 ${active
                          ? 'bg-blue-600 text-white shadow-[0_2px_12px_rgba(37,99,235,0.45)]'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
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
        <div className="p-3 border-t border-blue-900/40 space-y-2 bg-[#051122]/70">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 text-white text-[10px] font-bold">
              {user ? getInitials(user.full_name) : '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate">{user?.full_name || user?.email || '—'}</p>
              <p className="text-slate-400 text-[10px] truncate">{user ? getRoleLabel(user.role) : ''}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white text-xs font-medium transition-all cursor-pointer"
          >
            <LogOut size={13} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
