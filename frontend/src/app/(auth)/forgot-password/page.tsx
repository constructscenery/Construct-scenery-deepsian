'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, ArrowLeft } from 'lucide-react';
import { authApi } from '@/lib/api';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail]     = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      // Store email in sessionStorage for subsequent steps
      sessionStorage.setItem('otp_email', email);
      router.push('/verify-otp');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
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
          <Mail size={22} className="text-blue-600" />
        </div>

        <h1 className="text-slate-900 font-bold text-lg mb-1">Reset password</h1>
        <p className="text-slate-500 text-sm mb-6">
          Enter your email and we&apos;ll send you a one-time code.
        </p>

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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Send OTP'
            )}
          </button>
        </form>
      </div>

      <p className="text-center mt-5">
        <Link href="/login" className="text-slate-500 text-sm hover:text-slate-700 flex items-center justify-center gap-1.5">
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
