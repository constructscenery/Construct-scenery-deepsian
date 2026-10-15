'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, LogIn, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const params = useSearchParams();
  const [banner, setBanner] = useState('');

  useEffect(() => {
    if (params.get('reset') === '1')      setBanner('Password reset successfully. Please sign in.');
    if (params.get('registered') === '1') setBanner('Account created successfully. Please sign in.');
  }, [params]);

  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // AppShell redirects to /dashboard automatically
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="flex justify-center mb-8">
        <div className="flex items-center gap-3">
          <img src="/construct scenery logo.png" alt="Construct Scenery Database" className="w-10 h-10 rounded-xl object-cover shadow-lg flex-shrink-0" />
          <div>
            <p className="text-slate-900 font-bold text-lg leading-tight">Construct Scenery Database</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-8 py-8">
        <h1 className="text-slate-900 font-bold text-lg mb-1">Sign in</h1>
        <p className="text-slate-500 text-sm mb-6">Welcome back</p>

        {banner && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-blue-700 text-sm flex items-center gap-2">
            <CheckCircle2 size={15} className="flex-shrink-0" />
            {banner}
          </div>
        )}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@constructscenery.co.uk"
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-slate-700">Password</label>
              <Link href="/forgot-password" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 pr-10 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <LogIn size={15} />
                Sign in
              </>
            )}
          </button>
        </form>
      </div>

      <p className="text-center text-slate-400 text-xs mt-5">
        Accounts are created by your Managing Director — contact them for access.
      </p>
    </div>
  );
}
