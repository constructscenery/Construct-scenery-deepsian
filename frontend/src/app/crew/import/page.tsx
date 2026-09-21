'use client';

import TopBar from '@/components/TopBar';
import CrewImportTab from '../CrewImportTab';

export default function CrewImportPage() {
  return (
    <>
      <TopBar title="Crew Bulk Import" subtitle="Import your existing crew roster from a CSV file" />
      <main className="flex-1">
        <CrewImportTab />
      </main>
    </>
  );
}
