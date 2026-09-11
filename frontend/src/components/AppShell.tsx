'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { useAuth } from '@/contexts/AuthContext';

const AUTH_PATHS = ['/login', '/forgot-password', '/verify-otp', '/reset-password'];
const PUBLIC_PORTAL_PATHS = ['/crew-registration'];

// Land on Dashboard for all authenticated roles.
const homeRouteFor = (_role: string) => '/dashboard';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname();
  const router    = useRouter();
  const { user, loading } = useAuth();

  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p));
  const isPublicPortal = PUBLIC_PORTAL_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (loading) return;
    if (isPublicPortal) return;
    if (!isAuthPage && !user) router.replace('/login');
    if (isAuthPage && user)   router.replace(homeRouteFor(user.role));
  }, [loading, user, isAuthPage, isPublicPortal, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isPublicPortal) {
    return (
      <div className="min-h-screen bg-slate-50">
        {children}
      </div>
    );
  }

  if (isAuthPage) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        {children}
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <Sidebar />

      {/* Watermark — floats above tables/content, below modals/dropdowns */}
      <div className="pointer-events-none select-none fixed inset-0 md:left-60 z-20 flex items-center justify-center">
        <img
          src="/construct scenery logo.png"
          alt=""
          aria-hidden="true"
          className="w-[80%] h-[80%] object-cover opacity-[0.03]"
        />
      </div>

      {/* Main content: no left pad on mobile, pl-60 on desktop */}
      <div className="md:pl-60 min-h-screen flex flex-col pb-16 md:pb-0">
        {children}
      </div>

      {/* Mobile bottom nav — hidden on desktop */}
      <BottomNav />
    </>
  );
}
