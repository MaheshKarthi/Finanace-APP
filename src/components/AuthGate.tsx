import { useState, useEffect, type ReactNode } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import { pullAll, pushAll } from '../lib/sync';
import type { Session } from '@supabase/supabase-js';
import { LogIn, UserPlus, CloudOff } from 'lucide-react';

interface Props { children: ReactNode }

export default function AuthGate({ children }: Props) {
  const [session, setSession] = useState<Session | null | 'loading'>('loading');
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isConfigured()) { setSession(null); return; }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        // Pull latest cloud data on load
        pullAll().catch(console.error);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) {
        pullAll().catch(console.error);
        // Attempt push registration silently after login (user can manage in Settings)
        import('../lib/push').then(m => m.registerPush()).catch(() => {});
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // If Supabase not configured, run without auth (local-only mode)
  if (!isConfigured()) return <>{children}</>;
  if (session === 'loading') return (
    <div className="h-dvh flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (session) return <>{children}</>;

  // ── Auth forms ────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Account created! Check your email to confirm, then log in.');
        setMode('login');
        // Push any existing local data to the new account after confirmation
        setTimeout(() => pushAll(), 3000);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMessage('Password reset email sent — check your inbox.');
        setMode('login');
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    }
    setBusy(false);
  }

  return (
    <div className="h-dvh flex flex-col items-center justify-center bg-slate-50 p-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-3xl font-bold">₹</div>
        <h1 className="text-2xl font-bold text-slate-800">Finance Tracker</h1>
        <p className="text-slate-400 text-sm mt-1">Your household finances, anywhere</p>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-sm p-6 w-full max-w-sm">
        <h2 className="text-base font-semibold text-slate-700 mb-4">
          {mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="input" placeholder="you@example.com" autoComplete="email" />
          </div>
          {mode !== 'reset' && (
            <div>
              <label className="label">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="input" placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </div>
          )}

          {error && <p className="text-xs text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
          {message && <p className="text-xs text-emerald-600 bg-emerald-50 rounded-xl px-3 py-2">{message}</p>}

          <button type="submit" disabled={busy}
            className="btn-primary w-full flex items-center justify-center gap-2">
            {busy ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
              mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
            {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Email'}
          </button>
        </form>

        {/* Toggle links */}
        <div className="mt-4 flex flex-col items-center gap-2">
          {mode === 'login' && <>
            <button onClick={() => setMode('signup')} className="text-xs text-indigo-500 hover:underline">New here? Create an account</button>
            <button onClick={() => setMode('reset')} className="text-xs text-slate-400 hover:underline">Forgot password?</button>
          </>}
          {mode !== 'login' && (
            <button onClick={() => setMode('login')} className="text-xs text-indigo-500 hover:underline">Back to sign in</button>
          )}
        </div>
      </div>

      {/* Local-only fallback */}
      <button onClick={() => setSession(null as any)}
        className="mt-6 flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600">
        <CloudOff size={14} /> Continue without account (local only)
      </button>
    </div>
  );
}
