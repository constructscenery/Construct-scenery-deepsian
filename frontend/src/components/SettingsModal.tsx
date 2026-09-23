'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Camera, User, Mail, Lock, Eye, EyeOff, Check, AlertCircle, Loader2, Moon, Sun, LayoutGrid } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useUIPreferences } from '@/contexts/UIPreferencesContext';
import { profileApi } from '@/lib/api';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

type Tab = 'profile' | 'password';

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { user, updateUser } = useAuth();
  const { isDark, toggleTheme, sidebarIcons, toggleSidebarIcons } = useUIPreferences();

  // ─── Tab ──────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('profile');

  // ─── Profile fields ───────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');

  // ─── Password fields ──────────────────────────────────────────────────────────
  const [currentPw, setCurrentPw]   = useState('');
  const [newPw, setNewPw]           = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw]         = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  // ─── Avatar ───────────────────────────────────────────────────────────────────
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile]       = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── State ────────────────────────────────────────────────────────────────────
  const [saving, setSaving]     = useState(false);
  const [success, setSuccess]   = useState('');
  const [error, setError]       = useState('');

  // Sync fields when modal opens
  useEffect(() => {
    if (open && user) {
      setFullName(user.full_name);
      setEmail(user.email);
      setAvatarPreview(user.avatar_url ?? null);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setAvatarFile(null);
      setSuccess('');
      setError('');
      setTab('profile');
    }
  }, [open, user]);

  if (!open || !user) return null;

  // ─── Avatar pick ──────────────────────────────────────────────────────────────
  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  // ─── Save profile ─────────────────────────────────────────────────────────────
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const changes: Parameters<typeof profileApi.update>[0] = {};
      if (fullName.trim() !== user.full_name) changes.full_name = fullName.trim();
      if (email.trim().toLowerCase() !== user.email.toLowerCase()) changes.email = email.trim();

      // Upload avatar first if a new one was picked
      let newAvatarUrl: string | undefined = undefined;
      if (avatarFile) {
        const res = await profileApi.uploadAvatar(avatarFile);
        newAvatarUrl = res.avatar_url;
        updateUser({ avatar_url: res.avatar_url });
        setAvatarPreview(res.avatar_url);
        setAvatarFile(null);
      }

      if (Object.keys(changes).length > 0) {
        const { user: updated } = await profileApi.update(changes);
        updateUser({
          full_name: updated.full_name,
          email: updated.email,
          avatar_url: newAvatarUrl ?? updated.avatar_url ?? undefined,
        });
      }

      setSuccess('Profile updated successfully');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  // ─── Save password ────────────────────────────────────────────────────────────
  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPw || !newPw || !confirmPw) {
      setError('All password fields are required');
      return;
    }
    if (newPw.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setError('New passwords do not match');
      return;
    }

    setSaving(true);
    try {
      await profileApi.update({ current_password: currentPw, new_password: newPw });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setSuccess('Password changed successfully');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="settings-modal-title" className="text-base font-semibold text-slate-900">Account Settings</h2>
          <button
            id="settings-modal-close"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Profile & Display Settings Banner (at the very top beside profile) */}
        <div className="pt-5 pb-4 px-6 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4">
          {/* Profile details */}
          <div className="flex items-center gap-3.5">
            <div className="relative group flex-shrink-0">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-blue-500 flex items-center justify-center ring-3 ring-white shadow-md">
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt={user.full_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-white text-xl font-bold select-none">
                    {getInitials(user.full_name)}
                  </span>
                )}
              </div>
              {/* Camera overlay */}
              <button
                id="settings-avatar-upload-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                aria-label="Change profile picture"
              >
                <Camera size={18} className="text-white" />
              </button>
              <input
                ref={fileInputRef}
                id="settings-avatar-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarChange}
                aria-label="Upload profile picture"
              />
            </div>
            <div className="text-left min-w-0">
              <p className="font-semibold text-slate-900 text-sm leading-snug truncate">{user.full_name}</p>
              <p className="text-xs text-slate-500 capitalize">{user.role.replace(/_/g, ' ')}</p>
              <p className="text-[11px] text-slate-400 truncate max-w-[170px]">{user.email}</p>
              {avatarFile && (
                <p className="mt-1 text-[11px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block">
                  New photo selected
                </p>
              )}
            </div>
          </div>

          {/* Two toggles beside profile */}
          <div className="flex flex-col gap-2 w-full sm:w-auto min-w-[190px] bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs">
            {/* 1. Night and Day Mode Toggle */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                {isDark ? (
                  <Moon size={14} className="text-indigo-400 fill-indigo-400/20" />
                ) : (
                  <Sun size={14} className="text-amber-500 fill-amber-500/20" />
                )}
                <span>{isDark ? 'Night mode' : 'Day mode'}</span>
              </div>
              <button
                type="button"
                id="settings-night-mode-toggle"
                role="switch"
                aria-checked={isDark}
                onClick={toggleTheme}
                title={isDark ? 'Switch to Day mode' : 'Switch to Night mode'}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isDark ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    isDark ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* 2. Enable Icons Toggle (tabs & sub-tabs) */}
            <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-slate-100">
              <div className="flex flex-col text-left">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <LayoutGrid size={13} className={sidebarIcons ? 'text-blue-500' : 'text-slate-400'} />
                  <span>Enable icons</span>
                </span>
                <span className="text-[9px] text-slate-400 leading-tight">tabs &amp; sub-tabs</span>
              </div>
              <button
                type="button"
                id="settings-sidebar-icons-toggle"
                role="switch"
                aria-checked={sidebarIcons}
                onClick={toggleSidebarIcons}
                title={sidebarIcons ? 'Disable sidebar icons' : 'Enable sidebar icons'}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  sidebarIcons ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    sidebarIcons ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-6 pt-2">
          {([['profile', 'Profile', User], ['password', 'Password', Lock]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              onClick={() => { setTab(id); setError(''); setSuccess(''); }}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-normal border-b-2 mr-2 transition-colors ${
                tab === id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {sidebarIcons && <Icon size={14} />}
              {label}
            </button>
          ))}
        </div>

        {/* Alert banner */}
        {(success || error) && (
          <div className={`mx-6 mt-4 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm ${
            success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {success ? <Check size={14} className="flex-shrink-0" /> : <AlertCircle size={14} className="flex-shrink-0" />}
            {success || error}
          </div>
        )}

        {/* Form body */}
        <div className="px-6 py-4">

          {/* ── Profile tab ─────────────────────────────────────────────────── */}
          {tab === 'profile' && (
            <form id="settings-profile-form" onSubmit={handleSaveProfile} className="flex flex-col gap-4">
              {/* Full name */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-full-name" className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <User size={12} /> Full Name
                </label>
                <input
                  id="settings-full-name"
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                  className="h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  placeholder="Your full name"
                />
              </div>

              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-email" className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <Mail size={12} /> Email
                </label>
                <input
                  id="settings-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  placeholder="your@email.com"
                />
              </div>

              <button
                id="settings-save-profile-btn"
                type="submit"
                disabled={saving}
                className="mt-1 h-9 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save Changes'}
              </button>
            </form>
          )}

          {/* ── Password tab ─────────────────────────────────────────────────── */}
          {tab === 'password' && (
            <form id="settings-password-form" onSubmit={handleSavePassword} className="flex flex-col gap-4">
              {[
                { id: 'settings-current-pw',  label: 'Current Password', value: currentPw,  setter: setCurrentPw,  show: showCurrentPw,  toggle: () => setShowCurrentPw(v => !v)  },
                { id: 'settings-new-pw',       label: 'New Password',     value: newPw,       setter: setNewPw,       show: showNewPw,       toggle: () => setShowNewPw(v => !v)       },
                { id: 'settings-confirm-pw',   label: 'Confirm Password', value: confirmPw,   setter: setConfirmPw,   show: showConfirmPw,   toggle: () => setShowConfirmPw(v => !v)   },
              ].map(({ id, label, value, setter, show, toggle }) => (
                <div key={id} className="flex flex-col gap-1.5">
                  <label htmlFor={id} className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                    <Lock size={12} /> {label}
                  </label>
                  <div className="relative">
                    <input
                      id={id}
                      type={show ? 'text' : 'password'}
                      value={value}
                      onChange={e => setter(e.target.value)}
                      className="w-full h-9 pl-3 pr-9 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={toggle}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={show ? 'Hide password' : 'Show password'}
                    >
                      {show ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-400">Minimum 8 characters</p>

              <button
                id="settings-save-password-btn"
                type="submit"
                disabled={saving}
                className="mt-1 h-9 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Change Password'}
              </button>
            </form>
          )}
        </div>

        {/* Bottom padding */}
        <div className="h-4" />
      </div>
    </div>
  );
}
