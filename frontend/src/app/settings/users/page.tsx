'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import { usersApi, type ManagedUser } from '@/lib/api';
import {
  Plus, X, Loader2, Shield, UserX, UserCheck, Eye, EyeOff,
  KeyRound, Trash2, Copy, Check, AlertTriangle, CheckCircle2,
} from 'lucide-react';

const ROLES = [
  { value: 'managing_director',        label: 'Managing Director' },
  { value: 'construction_accountant',  label: 'Construction Accountant' },
  { value: 'construction_coordinator', label: 'Construction Coordinator' },
  { value: 'guest',                    label: 'Guest (Read Only)' },
];

const roleLabel = (role: string) => ROLES.find(r => r.value === role)?.label ?? role;

const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500';

// ─── New User Modal ────────────────────────────────────────────────────────────

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole]         = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!role) { setError('Please select a role.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSaving(true);
    try {
      await usersApi.create({ email, password, full_name: fullName, role });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h2 className="text-slate-900 font-semibold text-base">New User Account</h2>
            <p className="text-slate-500 text-xs mt-0.5">Create credentials for staff or guest showcase</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Full Name</label>
            <input className={inputCls} required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Sarah Thompson" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input type="email" className={inputCls} required value={email} onChange={e => setEmail(e.target.value)} placeholder="sarah@constructscenery.co.uk" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                className={inputCls + ' pr-10'}
                required minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
              />
              <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">MD will be able to view and change this password at any time.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
            <select className={inputCls + ' bg-white'} required value={role} onChange={e => setRole(e.target.value)}>
              <option value="">Select a role…</option>
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>
                  {r.label} {r.value === 'guest' ? '(Read-only showcase)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 shadow-sm transition-all disabled:opacity-60">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Change Password Modal ─────────────────────────────────────────────────────

function ChangePasswordModal({
  user,
  onClose,
  onUpdated,
}: {
  user: ManagedUser;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await usersApi.changePassword(user.id, password);
      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h2 className="text-slate-900 font-semibold text-base flex items-center gap-2">
              <KeyRound size={16} className="text-blue-600" />
              Change Password
            </h2>
            <p className="text-slate-500 text-xs mt-0.5">For {user.full_name} ({user.email})</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">New Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                className={inputCls + ' pr-10'}
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter new password (min. 8 characters)"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              The updated password will be stored securely and readable by Managing Director.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 shadow-sm transition-all disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Save Password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ─────────────────────────────────────────────────

function DeleteUserModal({
  user,
  onClose,
  onDeleted,
}: {
  user: ManagedUser;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError]       = useState('');

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await usersApi.delete(user.id);
      onDeleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-red-50 text-red-900">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-600" />
            <h2 className="font-semibold text-base text-red-900">Permanently Delete Account</h2>
          </div>
          <button onClick={onClose} className="text-red-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <p className="text-sm text-slate-700">
            Are you sure you want to permanently delete <strong className="text-slate-900">{user.full_name}</strong> (<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{user.email}</code>)?
          </p>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            <p className="font-semibold">⚠️ Warning:</p>
            <p className="mt-0.5">This action cannot be undone. Any active sessions will be terminated and the account will be permanently removed.</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium">Cancel</button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 shadow-sm transition-all disabled:opacity-60"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete Permanently
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function UsersAdminPage() {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [users, setUsers]     = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [passwordModalUser, setPasswordModalUser] = useState<ManagedUser | null>(null);
  const [deleteModalUser, setDeleteModalUser]     = useState<ManagedUser | null>(null);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId]                   = useState<string | null>(null);
  const [updatingId, setUpdatingId]               = useState<string | null>(null);

  // Guard: only MD may view this page
  useEffect(() => {
    if (currentUser && currentUser.role !== 'managing_director') {
      router.replace('/productions');
    }
  }, [currentUser, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await usersApi.list());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRoleChange = async (u: ManagedUser, role: string) => {
    setUpdatingId(u.id);
    try {
      await usersApi.update(u.id, { role });
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleActive = async (u: ManagedUser) => {
    setUpdatingId(u.id);
    try {
      await usersApi.update(u.id, { is_active: !u.is_active });
      setSuccessMsg(`Account for ${u.full_name} ${!u.is_active ? 'reactivated' : 'deactivated'}.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleRevealPassword = (id: string) => {
    setRevealedPasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyPassword = (id: string, pass: string) => {
    navigator.clipboard.writeText(pass);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (currentUser && currentUser.role !== 'managing_director') return null;

  return (
    <>
      {showNew && (
        <NewUserModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            setSuccessMsg('New user account created successfully.');
            setTimeout(() => setSuccessMsg(''), 4000);
            load();
          }}
        />
      )}

      {passwordModalUser && (
        <ChangePasswordModal
          user={passwordModalUser}
          onClose={() => setPasswordModalUser(null)}
          onUpdated={() => {
            setPasswordModalUser(null);
            setSuccessMsg(`Password for ${passwordModalUser.full_name} updated successfully.`);
            setTimeout(() => setSuccessMsg(''), 4000);
            load();
          }}
        />
      )}

      {deleteModalUser && (
        <DeleteUserModal
          user={deleteModalUser}
          onClose={() => setDeleteModalUser(null)}
          onDeleted={() => {
            setDeleteModalUser(null);
            setSuccessMsg(`User ${deleteModalUser.full_name} permanently deleted.`);
            setTimeout(() => setSuccessMsg(''), 4000);
            load();
          }}
        />
      )}

      <TopBar title="User Accounts" subtitle="Manage credentials, passwords, active status, and guest showcase access" />

      <main className="flex-1 p-4 md:p-6 space-y-4">
        {/* Banner notification */}
        {successMsg && (
          <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm animate-in fade-in">
            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100/70 text-blue-700 flex items-center justify-center font-bold">
                <Shield size={20} />
              </div>
              <div>
                <h2 className="text-slate-900 font-semibold text-base">User Accounts</h2>
                <p className="text-slate-500 text-xs mt-0.5">
                  View and change passwords, deactivate or delete accounts, and manage guest showcase roles
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center justify-center gap-2 bg-blue-600 text-white text-sm rounded-xl px-4 py-2 hover:bg-blue-700 font-semibold shadow-sm transition-all"
            >
              <Plus size={16} /> New User Account
            </button>
          </div>

          {error && <div className="px-6 py-4 text-red-600 text-sm bg-red-50 border-b border-red-100">{error}</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left border-b border-slate-200/80">
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">User</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Password (MD Visible)</th>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}><td colSpan={5} className="px-6 py-5"><div className="h-4 bg-slate-100 rounded animate-pulse w-full" /></td></tr>
                  ))
                ) : users.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-400 text-sm">No user accounts found.</td></tr>
                ) : (
                  users.map(u => {
                    const isSelf = u.id === currentUser?.id;
                    const busy = updatingId === u.id;
                    const isPasswordRevealed = !!revealedPasswords[u.id];
                    const hasStoredPassword = !!u.display_password;

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Name & Email */}
                        <td className="px-6 py-4">
                          <p className="text-slate-900 font-semibold flex items-center gap-1.5">
                            {u.full_name}
                            {isSelf && (
                              <span className="text-[10px] bg-blue-100 text-blue-800 font-medium px-2 py-0.5 rounded-full">
                                You (MD)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">{u.email}</p>
                        </td>

                        {/* Role */}
                        <td className="px-4 py-4">
                          <select
                            value={u.role}
                            disabled={busy || isSelf}
                            onChange={e => handleRoleChange(u, e.target.value)}
                            className={`text-xs border rounded-lg px-2.5 py-1.5 font-medium outline-none transition-colors ${
                              u.role === 'guest'
                                ? 'bg-purple-50 border-purple-200 text-purple-700'
                                : 'bg-white border-slate-200 text-slate-700 focus:ring-1 focus:ring-blue-400'
                            } disabled:opacity-60`}
                          >
                            {ROLES.map(r => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                              u.is_active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${u.is_active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            {u.is_active ? 'Active' : 'Deactivated'}
                          </span>
                        </td>

                        {/* Password Viewing & Copy */}
                        <td className="px-4 py-4">
                          {hasStoredPassword ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs px-2.5 py-1 bg-slate-100 rounded-md text-slate-800 tracking-wider select-all border border-slate-200">
                                {isPasswordRevealed ? u.display_password : '••••••••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleRevealPassword(u.id)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 transition-colors"
                                title={isPasswordRevealed ? 'Hide password' : 'View password'}
                              >
                                {isPasswordRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopyPassword(u.id, u.display_password!)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 rounded-md hover:bg-slate-100 transition-colors"
                                title="Copy password to clipboard"
                              >
                                {copiedId === u.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                              <span>Password hidden</span>
                              <button
                                onClick={() => setPasswordModalUser(u)}
                                className="not-italic text-blue-600 hover:text-blue-800 font-medium underline text-[11px]"
                              >
                                Set Password
                              </button>
                            </div>
                          )}
                        </td>

                        {/* Action Buttons */}
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Change Password */}
                            <button
                              onClick={() => setPasswordModalUser(u)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 hover:text-blue-700 font-medium rounded-lg transition-colors disabled:opacity-50"
                              title="Change user's password"
                            >
                              <KeyRound size={13} className="text-blue-600" />
                              <span className="hidden sm:inline">Change Password</span>
                            </button>

                            {/* Deactivate / Reactivate */}
                            {!isSelf && (
                              <button
                                onClick={() => handleToggleActive(u)}
                                disabled={busy}
                                className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 border font-medium rounded-lg transition-colors disabled:opacity-50 ${
                                  u.is_active
                                    ? 'border-slate-200 hover:bg-amber-50 hover:text-amber-800 text-slate-600'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                                title={u.is_active ? 'Deactivate account' : 'Reactivate account'}
                              >
                                {busy ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : u.is_active ? (
                                  <>
                                    <UserX size={13} className="text-amber-600" />
                                    <span className="hidden sm:inline">Deactivate</span>
                                  </>
                                ) : (
                                  <>
                                    <UserCheck size={13} className="text-emerald-600" />
                                    <span className="hidden sm:inline">Reactivate</span>
                                  </>
                                )}
                              </button>
                            )}

                            {/* Permanently Delete */}
                            {!isSelf && (
                              <button
                                onClick={() => setDeleteModalUser(u)}
                                disabled={busy}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1.5 border border-red-200 hover:bg-red-50 text-red-600 hover:text-red-800 font-medium rounded-lg transition-colors disabled:opacity-50"
                                title="Permanently delete account"
                              >
                                <Trash2 size={13} />
                                <span className="hidden md:inline">Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
