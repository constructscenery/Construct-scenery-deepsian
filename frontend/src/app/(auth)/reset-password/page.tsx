'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { authApi } from '@/lib/api';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail]         = useState('');
  const [otp, setOtp]             = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [showConf, setShowConf]   = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    const e = sessionStorage.getItem('otp_email');
    const o = sessionStorage.getItem('otp_code');
    if (!e || !o) { router.replace('/forgot-password'); return; }
    setEmail(e);
    setOtp(o);
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await authApi.resetPassword(email, otp, password);
      sessionStorage.removeItem('otp_email');
      sessionStorage.removeItem('otp_code');
      router.push('/login?reset=1');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed');
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
        <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-5">
          <KeyRound size={22} className="text-blue-600" />
        </div>

        <h1 className="text-slate-900 font-bold text-lg mb-1">Create new password</h1>
        <p className="text-slate-500 text-sm mb-6">
          Choose a strong password for your account.
        </p>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">New password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full px-3.5 py-2.5 pr-10 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
            <div className="relative">
              <input
                type={showConf ? 'text' : 'password'}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                className={`w-full px-3.5 py-2.5 pr-10 border rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                  confirm && confirm !== password ? 'border-red-300 bg-red-50' : 'border-slate-200'
                }`}
              />
              <button type="button" onClick={() => setShowConf(!showConf)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showConf ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {confirm && confirm !== password && (
              <p className="text-red-500 text-xs mt-1">Passwords do not match</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Reset password'
            )}
          </button>
        </form>
      </div>

      <p className="text-center mt-5">
        <Link href="/login" className="text-slate-500 text-sm hover:text-slate-700">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
