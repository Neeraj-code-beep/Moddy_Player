import { useEffect, useRef, useState } from 'react';
import { changePassword, login, logout, register, updateProfile } from '../api/api';

const inputClass = 'mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white placeholder:text-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-100';

export default function AuthPanel({ user, onUserChange, onClose }) {
  const [mode, setMode] = useState(user ? 'profile' : 'login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', bio: '', avatarUrl: '', currentPassword: '', newPassword: '' });
  useEffect(() => {
    if (user) setForm((old) => ({ ...old, name: user.name || '', email: user.email || '', bio: user.bio || '', avatarUrl: user.avatarUrl || '' }));
  }, [user]);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => dialog?.querySelectorAll('button:not([disabled]), input:not([disabled])') || [];
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, []);
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));
  const run = async (action) => {
    setBusy(true); setError('');
    try { await action(); } catch (reason) {
      setError(reason?.response?.data?.error?.message || 'The request could not be completed. Please try again.');
    } finally { setBusy(false); }
  };
  const submit = (event) => {
    event.preventDefault();
    if (mode === 'login') void run(async () => { onUserChange(await login({ email: form.email, password: form.password })); onClose(); });
    if (mode === 'register') {
      if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
      void run(async () => { onUserChange(await register({ name: form.name, email: form.email, password: form.password })); onClose(); });
    }
    if (mode === 'profile') void run(async () => { onUserChange(await updateProfile({ name: form.name || user.name, bio: form.bio, ...(form.avatarUrl ? { avatarUrl: form.avatarUrl } : {}) })); setError('Profile saved.'); });
    if (mode === 'password') void run(async () => { onUserChange(await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword })); setForm((old) => ({ ...old, currentPassword: '', newPassword: '' })); setError('Password changed. Other sessions were signed out.'); });
  };
  const field = (label, key, type = 'text', required = false) => <label className="block text-sm text-white/80">{label}<input className={inputClass} type={type} value={form[key]} onChange={set(key)} required={required} autoComplete={key === 'currentPassword' ? 'current-password' : key === 'newPassword' || key === 'password' ? (mode === 'register' ? 'new-password' : 'current-password') : undefined} /></label>;

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="account-title" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#171715] p-6 shadow-2xl">
      <div className="mb-5 flex items-center justify-between"><h2 id="account-title" className="text-xl font-semibold text-white">{user ? 'Your account' : 'Welcome to Moddy'}</h2><button type="button" onClick={onClose} aria-label="Close account" className="rounded-lg px-3 py-2 text-white/70 hover:bg-white/10">Close</button></div>
      {user && <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Account settings">{[['profile', 'Profile'], ['password', 'Password']].map(([value, label]) => <button type="button" role="tab" aria-selected={mode === value} key={value} onClick={() => { setMode(value); setError(''); }} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white aria-selected:bg-amber-100 aria-selected:text-black">{label}</button>)}</div>}
      {!user && <div className="mb-5 flex gap-2"><button type="button" onClick={() => setMode('login')} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white">Sign in</button><button type="button" onClick={() => setMode('register')} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white">Create account</button></div>}
      <form className="space-y-4" onSubmit={submit}>
        {mode === 'register' && field('Name', 'name', 'text', true)}
        {(mode === 'login' || mode === 'register') && <>{field('Email', 'email', 'email', true)}{field('Password', 'password', 'password', true)}{mode === 'register' && field('Confirm password', 'confirmPassword', 'password', true)}</>}
        {mode === 'profile' && <>{field('Name', 'name')}{field('Bio', 'bio')}{field('Avatar URL', 'avatarUrl', 'url')}<p className="text-xs text-white/50">Avatar images must come from the configured image service.</p></>}
        {mode === 'password' && <>{field('Current password', 'currentPassword', 'password', true)}{field('New password', 'newPassword', 'password', true)}<p className="text-xs text-white/50">Use at least 12 characters with lowercase, uppercase, a number, and a symbol.</p></>}
        {error && <p role="status" className="text-sm text-amber-100">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-amber-100 px-5 py-3 font-semibold text-[#201b13] disabled:opacity-50">{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'password' ? 'Change password' : 'Save profile'}</button>
      </form>
      {user && <div className="mt-5 border-t border-white/10 pt-4"><p className="mb-3 text-sm text-white/60">Signed in as {user.email}</p><button type="button" disabled={busy} onClick={() => void run(async () => { await logout(); onUserChange(null); onClose(); })} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">Sign out</button></div>}
    </section>
  </div>;
}
