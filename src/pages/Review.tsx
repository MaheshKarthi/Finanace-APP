/**
 * /review — Shows SMS transactions waiting for confirmation.
 * Opened automatically when the user taps a push notification.
 * Also reachable from the Expenses tab badge.
 */
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase, isConfigured } from '../lib/supabase';
import { db } from '../db/db';
import { useApp } from '../context/AppContext';
import { afterWrite } from '../context/AppContext';
import { fmt } from '../lib/utils';
import type { Person } from '../db/types';
import { Check, X, ChevronLeft, Bell } from 'lucide-react';

interface PendingRow {
  id: string;
  raw_sms: string;
  sender: string | null;
  sms_time: string;
  parsed: {
    type: string;
    amount: number;
    description: string;
    category: string;
    date: string;
    bank: string;
    merchantCount?: number;
  };
  user_action: string | null;
}

export default function Review() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { settings, personName } = useApp();
  const focusId = params.get('id');

  const [rows, setRows]   = useState<PendingRow[]>([]);
  const [busy, setBusy]   = useState<string | null>(null);
  const [done, setDone]   = useState<string[]>([]);
  const [person, setPerson] = useState<Person>('person1');

  const categories = settings?.expenseCategories ?? [];

  useEffect(() => {
    if (!isConfigured()) return;
    supabase
      .from('pending_sms')
      .select('*')
      .eq('processed', false)
      .is('user_action', null)          // only truly pending ones
      .order('sms_time', { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const all = data as PendingRow[];
        // Put the focused one first (from notification tap)
        if (focusId) {
          const idx = all.findIndex(r => r.id === focusId);
          if (idx > 0) { const [r] = all.splice(idx, 1); all.unshift(r); }
        }
        setRows(all);
      });
  }, [focusId]);

  async function confirm(row: PendingRow, cat: string) {
    setBusy(row.id);
    try {
      await db.expenses.add({
        date:        row.parsed.date,
        person,
        category:    cat,
        amount:      row.parsed.amount,
        description: row.parsed.description || row.sender || 'SMS import',
        note:        `Auto from SMS · ${row.sender ?? ''}`,
        createdAt:   new Date().toISOString(),
      });
      afterWrite();

      if (isConfigured()) {
        await supabase
          .from('pending_sms')
          .update({ user_action: 'confirmed', processed: true })
          .eq('id', row.id);
      }
      setDone(d => [...d, row.id]);
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(id: string) {
    setBusy(id);
    if (isConfigured()) {
      await supabase.from('pending_sms').update({ user_action: 'dismissed', processed: true }).eq('id', id);
    }
    setDone(d => [...d, id]);
    setBusy(null);
  }

  const visible = rows.filter(r => !done.includes(r.id));

  return (
    <div className="p-4 space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-slate-400 hover:text-slate-700">
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-800">SMS Review</h1>
          <p className="text-xs text-slate-400">{visible.length} transaction{visible.length !== 1 ? 's' : ''} waiting</p>
        </div>
        <Bell size={18} className="text-indigo-400" />
      </div>

      {/* Person selector */}
      <div>
        <label className="label">Assign to</label>
        <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
          {(['person1', 'person2'] as Person[]).map(p => (
            <button key={p} onClick={() => setPerson(p)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                person === p ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'
              }`}>
              {personName(p)}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {!isConfigured() && (
        <div className="bg-amber-50 rounded-2xl p-6 text-center">
          <p className="text-amber-700 text-sm font-medium">Cloud sync not set up yet.</p>
          <p className="text-amber-500 text-xs mt-1">Configure Supabase in Settings to use SMS auto-tracking.</p>
        </div>
      )}

      {isConfigured() && visible.length === 0 && (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <Check size={32} className="mx-auto text-emerald-400 mb-3" />
          <p className="text-slate-600 font-medium">All caught up!</p>
          <p className="text-slate-400 text-sm mt-1">No pending SMS transactions.</p>
        </div>
      )}

      {/* Pending cards */}
      <div className="space-y-4">
        {visible.map(row => (
          <ReviewCard
            key={row.id}
            row={row}
            categories={categories}
            busy={busy === row.id}
            onConfirm={cat => confirm(row, cat)}
            onDismiss={() => dismiss(row.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Individual review card ────────────────────────────────────────────────────
function ReviewCard({ row, categories, busy, onConfirm, onDismiss }: {
  row: PendingRow;
  categories: string[];
  busy: boolean;
  onConfirm: (category: string) => void;
  onDismiss: () => void;
}) {
  const [cat, setCat] = useState(row.parsed.category ?? categories[0] ?? '');
  const mc = row.parsed.merchantCount ?? 0;
  const confidence = mc >= 10 ? 'High' : mc >= 3 ? 'Medium' : mc >= 1 ? 'Low' : null;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* Top strip — bank + confidence */}
      <div className={`px-4 py-2 flex items-center justify-between text-xs ${
        confidence === 'High' ? 'bg-emerald-50 text-emerald-700'
        : confidence === 'Medium' ? 'bg-amber-50 text-amber-700'
        : 'bg-slate-50 text-slate-500'
      }`}>
        <span>{row.parsed.bank} · {new Date(row.sms_time).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        {confidence && (
          <span className="font-semibold">
            {confidence} confidence {mc > 0 && `· seen ${mc}×`}
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Amount + merchant */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-2xl font-bold text-slate-800">{fmt(row.parsed.amount)}</p>
            <p className="text-sm text-slate-600 mt-0.5">{row.parsed.description || row.sender}</p>
          </div>
          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full mt-1">
            {row.parsed.date}
          </span>
        </div>

        {/* Raw SMS (collapsed) */}
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer">Raw SMS</summary>
          <p className="mt-1 font-mono break-all">{row.raw_sms}</p>
        </details>

        {/* Category picker */}
        <div>
          <label className="label">Category</label>
          <select value={cat} onChange={e => setCat(e.target.value)} className="input">
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onConfirm(cat)}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-xl py-3 font-semibold text-sm active:scale-95 transition-all disabled:opacity-50"
          >
            {busy
              ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Check size={16} />}
            Confirm
          </button>
          <button
            onClick={onDismiss}
            disabled={busy}
            className="flex items-center justify-center gap-1 bg-slate-100 text-slate-500 rounded-xl px-4 py-3 text-sm font-medium"
          >
            <X size={16} /> Skip
          </button>
        </div>
      </div>
    </div>
  );
}
