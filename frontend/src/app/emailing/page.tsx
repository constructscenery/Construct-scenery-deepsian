'use client';

import { Suspense, useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, Send, Inbox, CalendarCheck, History, FileText, Settings2 } from 'lucide-react';
import TopBar from '@/components/TopBar';
import RequireRole from '@/components/RequireRole';
import { useAuth } from '@/contexts/AuthContext';
import OverviewTab from './_components/OverviewTab';
import ComposeTab, { type ComposePreset } from './_components/ComposeTab';
import SubmissionsTab from './_components/SubmissionsTab';
import AvailabilityTab from './_components/AvailabilityTab';
import HistoryTab from './_components/HistoryTab';
import TemplatesTab from './_components/TemplatesTab';
import SettingsTab from './_components/SettingsTab';

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'compose', label: 'Compose', icon: Send, staffOnly: true },
  { key: 'submissions', label: 'Submissions', icon: Inbox },
  { key: 'availability', label: 'Availability', icon: CalendarCheck },
  { key: 'history', label: 'History', icon: History },
  { key: 'templates', label: 'Templates', icon: FileText },
  { key: 'settings', label: 'Settings', icon: Settings2 },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function EmailingPage() {
  return (
    <RequireRole roles={['managing_director', 'construction_accountant', 'construction_coordinator', 'guest']}>
      <Suspense fallback={null}>
        <EmailingContent />
      </Suspense>
    </RequireRole>
  );
}

function EmailingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const readOnly = user?.role === 'guest';

  const visibleTabs = TABS.filter((t) => !('staffOnly' in t && t.staffOnly && readOnly));
  const fromUrl = params.get('tab') as TabKey | null;
  const tab: TabKey = fromUrl && visibleTabs.some((t) => t.key === fromUrl) ? fromUrl : 'overview';
  const [preset, setPreset] = useState<ComposePreset | null>(null);

  const go = useCallback((next: TabKey) => {
    const qs = new URLSearchParams(Array.from(params.entries()));
    qs.set('tab', next);
    router.replace(`/emailing?${qs.toString()}`, { scroll: false });
  }, [params, router]);

  const compose = useCallback((p: ComposePreset) => {
    setPreset({ ...p, nonce: Date.now() });
    go('compose');
  }, [go]);

  return (
    <>
      <TopBar title="Emailing" subtitle="Crew timesheet reminders, invoice requests, availability and messages" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5 min-w-0">
        <nav className="bg-white rounded-xl border border-slate-200 shadow-sm p-1.5 overflow-x-auto" aria-label="Emailing sections">
          <div className="flex gap-1 min-w-max">
            {visibleTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => go(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  tab === key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                }`}
                aria-current={tab === key ? 'page' : undefined}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </nav>

        {tab === 'overview' && <OverviewTab onNavigate={(t) => go(t as TabKey)} onCompose={compose} readOnly={readOnly} />}
        {tab === 'compose' && !readOnly && <ComposeTab key={preset?.nonce ?? 0} preset={preset} onSent={() => go('history')} />}
        {tab === 'submissions' && <SubmissionsTab readOnly={readOnly} />}
        {tab === 'availability' && <AvailabilityTab readOnly={readOnly} onCompose={compose} />}
        {tab === 'history' && <HistoryTab readOnly={readOnly} />}
        {tab === 'templates' && <TemplatesTab readOnly={readOnly} />}
        {tab === 'settings' && <SettingsTab readOnly={readOnly} />}
      </main>
    </>
  );
}
