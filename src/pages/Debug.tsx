import { useEffect, useState } from 'react';
import { supabase, isConfigured } from '../lib/supabase';

export default function Debug() {
  const [log, setLog] = useState<string[]>([]);

  const add = (msg: string) => setLog(p => [...p, msg]);

  useEffect(() => {
    async function run() {
      add('isConfigured: ' + isConfigured());
      add('SUPABASE_URL: ' + import.meta.env.VITE_SUPABASE_URL);

      const { data: { session }, error: se } = await supabase.auth.getSession();
      add('session error: ' + JSON.stringify(se));
      add('user id: ' + (session?.user?.id ?? 'NOT LOGGED IN'));

      if (!session?.user) { add('❌ Not logged in — stopping'); return; }

      const { data, error, count } = await supabase
        .from('pending_sms')
        .select('*', { count: 'exact' })
        .limit(10);

      add('pending_sms error: ' + JSON.stringify(error));
      add('pending_sms count: ' + count);
      add('pending_sms rows: ' + JSON.stringify(data?.length));
      if (data?.[0]) add('first row user_id: ' + data[0].user_id);

      const { data: data2, error: e2 } = await supabase
        .from('pending_sms')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('processed', false)
        .is('user_action', null);

      add('filtered error: ' + JSON.stringify(e2));
      add('filtered rows: ' + JSON.stringify(data2?.length));
    }
    run();
  }, []);

  return (
    <div className="p-4 font-mono text-xs space-y-1 bg-slate-900 text-green-400 min-h-screen">
      <p className="text-white font-bold mb-4">Debug Log</p>
      {log.map((l, i) => <p key={i}>{l}</p>)}
      {log.length === 0 && <p>Running...</p>}
    </div>
  );
}
