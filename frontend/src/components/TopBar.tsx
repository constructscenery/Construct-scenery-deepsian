'use client';

import { useState } from 'react';
import { Bell, Settings, Cloud } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import SettingsModal from '@/components/SettingsModal';
import SyncModal from '@/components/SyncModal';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  const { user, isGuest } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  return (
    <>
      <header className="h-14 md:h-16 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 gap-3 sticky top-0 z-20">
        {/* Mobile: logo */}
        <img src="/construct scenery logo.png" alt="Construct Scenery Database" className="md:hidden w-7 h-7 rounded-lg object-cover flex-shrink-0" />

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1 className="text-slate-900 font-semibold text-base md:text-lg leading-tight truncate">{title}</h1>
          {subtitle && <p className="hidden sm:block text-slate-500 text-xs truncate">{subtitle}</p>}
        </div>

        {/* Sync Button (visible on mobile and desktop for non-guests) */}
        {!isGuest && (
          <button
            id="topbar-sync-btn"
            onClick={() => setSyncOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-slate-200 rounded-lg transition-all"
            title="Export database to Excel & sync to S3"
            aria-label="Export and sync to S3"
          >
            <Cloud size={14} className="text-blue-600 flex-shrink-0" />
            <span className="hidden sm:inline">Export / Sync</span>
          </button>
        )}

        {/* Desktop-only actions */}
        <div className="hidden md:flex items-center gap-1">
          <button
            id="topbar-notifications-btn"
            className="relative p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Notifications"
          >
            <Bell size={18} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-orange-500 rounded-full" />
          </button>

          {!isGuest && (
            <button
              id="topbar-settings-btn"
              onClick={() => setSettingsOpen(true)}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              aria-label="Account settings"
            >
              <Settings size={18} />
            </button>
          )}

          {/* Avatar — also opens settings */}
          <button
            id="topbar-avatar-btn"
            onClick={() => setSettingsOpen(true)}
            className="ml-2 w-8 h-8 rounded-full overflow-hidden bg-blue-500 flex items-center justify-center flex-shrink-0 hover:ring-2 hover:ring-blue-400 transition-all"
            title={user?.full_name ?? 'Account settings'}
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

