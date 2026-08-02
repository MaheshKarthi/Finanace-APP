/**
 * Cloud sync layer — Supabase ↔ Dexie
 *
 * Strategy: entire table serialised as a JSON blob per user (sync_data table).
 * Simple, conflict-free for a 1-2 person household.
 *
 * pushAll  → serialise every Dexie table and upsert to Supabase
 * pullAll  → fetch from Supabase, clear Dexie tables, bulk-insert records
 * syncPending → fetch unprocessed pending_sms rows, create expense records
 */

import { supabase, isConfigured } from './supabase';
import { db } from '../db/db';
import type { ExpenseTx } from '../db/types';

const TABLES = ['settings', 'investments', 'expenses', 'importRules', 'holdingValues'] as const;

export async function pushAll(): Promise<void> {
  if (!isConfigured()) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const rows = await Promise.all(
    TABLES.map(async (t) => ({
      user_id: user.id,
      table_name: t,
      records: JSON.stringify(await (db as any)[t].toArray()),
      updated_at: new Date().toISOString(),
    }))
  );

  const { error } = await supabase.from('sync_data').upsert(rows, { onConflict: 'user_id,table_name' });
  if (error) console.error('[sync] push error', error.message);
}

export async function pullAll(): Promise<void> {
  if (!isConfigured()) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data, error } = await supabase
    .from('sync_data')
    .select('table_name, records')
    .eq('user_id', user.id);

  if (error || !data?.length) return;

  await db.transaction('rw', TABLES.map(t => (db as any)[t]), async () => {
    for (const row of data) {
      const tbl = (db as any)[row.table_name];
      if (!tbl) continue;
      const records: any[] = typeof row.records === 'string'
        ? JSON.parse(row.records)
        : row.records;
      // Strip ids so Dexie auto-assigns them (avoids PK clashes)
      const stripped = records.map(({ id: _id, ...rest }: any) => rest);
      await tbl.clear();
      if (stripped.length) await tbl.bulkAdd(stripped);
    }
  });
}

/** Fetch unprocessed SMS from cloud, auto-create expense records */
export async function syncPendingSMS(): Promise<number> {
  if (!isConfigured()) return 0;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data: rows, error } = await supabase
    .from('pending_sms')
    .select('*')
    .eq('user_id', user.id)
    .eq('processed', false)
    .order('created_at', { ascending: true });

  if (error || !rows?.length) return 0;

  // Get default person from settings
  const settings = await db.settings.toCollection().first();
  const person = 'person1'; // default; user can edit after import

  let created = 0;
  for (const row of rows) {
    const p = row.parsed as { type: string; amount: number; description: string; category: string; date: string };
    if (!p || p.type === 'unknown' || p.amount <= 0) continue;

    const categories = settings?.expenseCategories ?? [];
    const cat = categories.includes(p.category) ? p.category : 'Other';

    const expense: Omit<ExpenseTx, 'id'> = {
      date: p.date,
      person,
      category: cat,
      amount: p.amount,
      description: p.description || 'SMS import',
      note: `Auto-imported from SMS (${row.sender ?? 'unknown sender'})`,
      createdAt: row.created_at,
    };
    await db.expenses.add(expense);
    created++;
  }

  // Mark all as processed in one call
  const ids = rows.map((r: any) => r.id);
  await supabase.from('pending_sms').update({ processed: true }).in('id', ids);

  // Push the new expenses to cloud immediately
  if (created > 0) await pushAll();

  return created;
}

/** Auto-push after every write — call this after any DB mutation */
export function queuePush(): void {
  if (!isConfigured()) return;
  clearTimeout((queuePush as any)._t);
  (queuePush as any)._t = setTimeout(() => pushAll(), 2000); // debounce 2s
}
