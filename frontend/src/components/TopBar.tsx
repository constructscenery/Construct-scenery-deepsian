'use client';

import { useState } from 'react';
import { Bell, Settings, Cloud, Moon, Sun, LayoutGrid } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUIPreferences } from '@/contexts/UIPreferencesContext';
import SettingsModal from '@/components/SettingsModal';
import SyncModal from '@/components/SyncModal';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

function getInitials(name?: string | null) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  const { user, isGuest } = useAuth();
  const { isDark, toggleTheme, sidebarIcons, toggleSidebarIcons, flap1Open, flap2Open, setFlap1Open, setFlap2Open } = useUIPreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  return (
    <>
      <header className="h-14 md:h-16 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 gap-3 sticky top-0 z-20">
        {/* Mobile: logo */}
        <img src="/construct scenery logo.png" alt="Construct Scenery Database" className="md:hidden w-7 h-7 rounded-lg object-cover flex-shrink-0" />

        {/* Desktop: Sidebar quick expand triggers if flap 1 or flap 2 is closed */}
        {!flap1Open ? (
          <button
            onClick={() => setFlap1Open(true)}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 text-xs font-semibold transition-all cursor-pointer mr-1"
            title="Open Sidebar (Flap 1)"
            aria-label="Open Sidebar"
          >
            <img src="/the_office_chair_square.png" alt="" className="w-4 h-4 rounded object-cover" />
            <span>Open Sidebar</span>
          </button>
        ) : !flap2Open ? (
          <button
            onClick={() => setFlap2Open(true)}
            className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer mr-1"
            title="Expand Navigation Menu (Flap 2)"
            aria-label="Expand Navigation Menu"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">Drawer &gt;</span>
          </button>
        ) : null}

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1 className="text-slate-800 font-normal text-sm leading-tight truncate">{title}</h1>
          {subtitle && <p className="hidden sm:block text-slate-500 text-xs truncate">{subtitle}</p>}
        </div>

        {/* Sync Button (visible on mobile and desktop for non-guests) */}
        {!isGuest && (
          <button
            id="topbar-sync-btn"
            onClick={() => setSyncOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-normal text-slate-700 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-slate-200 rounded-lg transition-all"
            title="Export database to Excel & sync to S3"
            aria-label="Export and sync to S3"
          >
            <Cloud size={14} className="text-blue-600 flex-shrink-0" />
            <span className="hidden sm:inline">Export / Sync</span>
          </button>
        )}

        {/* Mobile theme toggle */}
        <button
          onClick={toggleTheme}
          className="md:hidden p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          title={isDark ? "Switch to Day mode" : "Switch to Night mode"}
          aria-label={isDark ? "Switch to Day mode" : "Switch to Night mode"}
        >
          {isDark ? (
            <Moon size={18} className="text-indigo-400 fill-indigo-400/20" />
          ) : (
            <Sun size={18} className="text-amber-500 fill-amber-500/20" />
          )}
        </button>

        {/* Desktop actions: toggles on the very top beside profile */}
        <div className="hidden md:flex items-center gap-1.5">
          {/* Night / Day mode toggle */}
          <button
            id="topbar-theme-toggle"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200"
            title={isDark ? "Switch to Day mode" : "Switch to Night mode"}
            aria-label={isDark ? "Switch to Day mode" : "Switch to Night mode"}
          >
            {isDark ? (
              <>
                <Moon size={15} className="text-indigo-400 fill-indigo-400/20" />
                <span className="text-[11px] font-medium text-indigo-300">Night</span>
              </>
            ) : (
              <>
                <Sun size={15} className="text-amber-500 fill-amber-500/20" />
                <span className="text-[11px] font-medium text-slate-600">Day</span>
              </>
            )}
          </button>

          {/* Sidebar icons toggle */}
          <button
            id="topbar-sidebar-icons-toggle"
            onClick={toggleSidebarIcons}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              sidebarIcons
                ? 'text-blue-600 bg-blue-50/60 border-blue-200/60 hover:bg-blue-100/60'
                : 'text-slate-500 border-transparent hover:border-slate-200 hover:bg-slate-100'
            }`}
            title={sidebarIcons ? "Disable sidebar icons (tabs & sub-tabs)" : "Enable sidebar icons (tabs & sub-tabs)"}
            aria-label="Toggle sidebar icons"
          >
            <LayoutGrid size={14} className={sidebarIcons ? 'text-blue-600' : 'text-slate-400'} />
            <span className="text-[11px]">Icons</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-200 mx-1" />

          {/* Notifications */}
          <button
            id="topbar-notifications-btn"
            className="relative p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Notifications"
          >
            <Bell size={18} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-orange-500 rounded-full" />
          </button>

          {/* Settings button */}
          {!isGuest && (
            <button
              id="topbar-settings-btn"
              onClick={() => setSettingsOpen(true)}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              aria-label="Account settings"
              title="Account settings"
            >
              <Settings size={18} />
            </button>
          )}

          {/* Avatar Profile — also opens settings */}
          <button
            id="topbar-avatar-btn"
            onClick={() => setSettingsOpen(true)}
            className="ml-1 w-8 h-8 rounded-full overflow-hidden bg-blue-500 flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-blue-400 transition-all cursor-pointer"
            title={user?.full_name ? `${user.full_name} (Settings)` : 'Account settings'}
            aria-label="Account settings"
          >
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-white text-xs font-bold select-none">
                {user ? getInitials(user.full_name) : '?'}
              </span>
            )}
          </button>
        </div>
      </header>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} />
    </>
  );
}

