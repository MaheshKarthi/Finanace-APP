import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, initDB } from '../db/db';
import { pushAll } from '../lib/sync';
import { isConfigured, supabase } from '../lib/supabase';
import type { Settings, Person } from '../db/types';

interface AppContextValue {
  settings: Settings | null;
  personFilter: Person | 'all';
  setPersonFilter: (p: Person | 'all') => void;
  updateSettings: (s: Partial<Settings>) => Promise<void>;
  personName: (p: Person) => string;
  syncNow: () => Promise<void>;
  lastSync: string | null;
  pendingSMSCount: number;
}

const AppContext = createContext<AppContextValue>({} as AppContextValue);

export function AppProvider({ children }: { children: ReactNode }) {
  const [personFilter, setPersonFilter] = useState<Person | 'all'>('all');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pendingSMSCount, setPendingSMSCount] = useState(0);
  const settings = useLiveQuery(() => db.settings.toCollection().first());

  useEffect(() => {
    initDB();
    if (!isConfigured()) return;

    async function checkSMS() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { count, error } = await supabase
        .from('pending_sms')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('processed', false)
        .is('user_action', null);
      if (error) console.error('[checkSMS]', error.message);
      setPendingSMSCount(count ?? 0);
    }

    // Run on auth state changes (login, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        checkSMS();
      } else {
        setPendingSMSCount(0);
      }
    });

    // Also poll every minute
    checkSMS();
    const interval = setInterval(checkSMS, 60 * 1000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, []);

  async function updateSettings(patch: Partial<Settings>) {
    const s = await db.settings.toCollection().first();
    if (s?.id != null) {
      await db.settings.update(s.id, patch);
      pushAll(); // fire-and-forget cloud push
    }
  }

  function personName(p: Person) {
    if (!settings) return p === 'person1' ? 'Mahesh' : 'Wife';
    return p === 'person1' ? settings.person1Name : settings.person2Name;
  }

  async function syncNow() {
    await pushAll();
    setLastSync(new Date().toLocaleTimeString('en-IN'));
  }

  return (
    <AppContext.Provider value={{
      settings: settings ?? null,
      personFilter, setPersonFilter,
      updateSettings,
      personName,
      syncNow, lastSync,
      pendingSMSCount,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);

// Helper: call after any investment/expense write to auto-push
export function afterWrite() {
  if (!isConfigured()) return;
  clearTimeout((afterWrite as any)._t);
  (afterWrite as any)._t = setTimeout(() => pushAll(), 2000);
}

export async function signOut() {
  if (isConfigured()) await supabase.auth.signOut();
  window.location.reload();
}
