'use client';

import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowLeft, RefreshCw } from 'lucide-react';
import { authApi } from '@/lib/api';

export default function VerifyOtpPage() {
  const router = useRouter();
  const [digits, setDigits]   = useState<string[]>(Array(6).fill(''));
  const [email, setEmail]     = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent]   = useState(false);
  const refs = useRef<Array<HTMLInputElement | null>>(Array(6).fill(null));

  useEffect(() => {
    const stored = sessionStorage.getItem('otp_email');
    if (!stored) { router.replace('/forgot-password'); return; }
    setEmail(stored);
    refs.current[0]?.focus();
  }, [router]);

  function handleChange(index: number, val: string) {
    const char = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < 5) refs.current[index + 1]?.focus();
  }

  function handleKey(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const next = [...digits];
    pasted.split('').forEach((c, i) => { next[i] = c; });
    setDigits(next);
    const lastFilled = Math.min(pasted.length, 5);
    refs.current[lastFilled]?.focus();
  }

  async function handleSubmit() {
    const otp = digits.join('');
    if (otp.length < 6) { setError('Please enter all 6 digits'); return; }
    setError('');
    setLoading(true);
    try {
      await authApi.verifyOtp(email, otp);
      sessionStorage.setItem('otp_code', otp);
      router.push('/reset-password');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setDigits(Array(6).fill(''));
      refs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError('');
    try {
      await authApi.forgotPassword(email);
      setResent(true);
      setDigits(Array(6).fill(''));
      refs.current[0]?.focus();
      setTimeout(() => setResent(false), 5000);
    } catch {
      setError('Failed to resend OTP');
    } finally {
      setResending(false);
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
          <ShieldCheck size={22} className="text-blue-600" />
        </div>

        <h1 className="text-slate-900 font-bold text-lg mb-1">Check your email</h1>
        <p className="text-slate-500 text-sm mb-6">
          We sent a 6-digit code to{' '}
          <span className="font-semibold text-slate-700">{email}</span>
        </p>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}
        {resent && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-blue-700 text-sm">
            New OTP sent to your email.
          </div>
        )}

        {/* OTP digit inputs */}
        <div className="flex gap-2.5 justify-center mb-6">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKey(i, e)}
              onPaste={handlePaste}
              className={`w-11 h-12 text-center text-lg font-bold border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
                d ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-900'
              }`}
            />
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'Verify code'
          )}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="w-full mt-3 text-slate-500 hover:text-slate-700 text-sm font-medium flex items-center justify-center gap-1.5 py-2 transition-colors"
        >
          <RefreshCw size={13} className={resending ? 'animate-spin' : ''} />
          {resending ? 'Sending...' : 'Resend code'}
        </button>
      </div>

      <p className="text-center mt-5">
        <Link href="/forgot-password" className="text-slate-500 text-sm hover:text-slate-700 flex items-center justify-center gap-1.5">
          <ArrowLeft size={14} />
          Back
        </Link>
      </p>
    </div>
  );
}
