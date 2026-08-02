import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { db } from '../db/db';
import { useApp } from '../context/AppContext';
import type { Person } from '../db/types';
import { today } from '../lib/utils';
import { Upload, Check, AlertCircle } from 'lucide-react';

interface Row {
  raw: Record<string, string>;
  date: string;
  description: string;
  amount: number;
  category: string | null;
  matched: boolean;
}

export default function CsvImport({ onDone }: { onDone: () => void }) {
  const { settings, personName } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [person, setPerson] = useState<Person>('person1');
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [saving, setSaving] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const categories = settings?.expenseCategories ?? [];

  async function matchRules(description: string): Promise<string | null> {
    const rules = await db.importRules.orderBy('priority').reverse().toArray();
    for (const rule of rules) {
      if (description.toLowerCase().includes(rule.pattern.toLowerCase())) {
        return rule.category;
      }
    }
    return null;
  }

  async function processRows(rawRows: Record<string, string>[]) {
    const parsed: Row[] = [];
    for (const raw of rawRows) {
      // Try to detect date, description, amount columns heuristically
      const vals = Object.values(raw);
      const keys = Object.keys(raw).map(k => k.toLowerCase());

      const dateKey = keys.find(k => k.includes('date') || k.includes('day')) ?? keys[0];
      const descKey = keys.find(k => k.includes('desc') || k.includes('narr') || k.includes('detail') || k.includes('particulars')) ?? keys[1];
      const amtKey = keys.find(k => k.includes('debit') || k.includes('amount') || k.includes('amt') || k.includes('withdrawal')) ?? keys[2];

      const rawKeys = Object.keys(raw);
      const dateVal = raw[rawKeys[keys.indexOf(dateKey)]] ?? vals[0] ?? '';
      const descVal = raw[rawKeys[keys.indexOf(descKey)]] ?? vals[1] ?? '';
      const amtStr = raw[rawKeys[keys.indexOf(amtKey)]] ?? vals[2] ?? '0';
      const amt = parseFloat(amtStr.replace(/[,₹\s]/g, '')) || 0;
      if (amt <= 0) continue;

      // Parse date — try multiple formats
      let date = today();
      const dm = dateVal.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (dm) {
        const y = dm[3].length === 2 ? '20' + dm[3] : dm[3];
        date = `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      } else {
        const iso = dateVal.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
        if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
      }

      const category = await matchRules(descVal);
      parsed.push({ raw, date, description: descVal, amount: amt, category, matched: category != null });
    }
    setRows(parsed);
    setStep('review');
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: r => processRows(r.data as Record<string, string>[]),
    });
  }

  function handlePaste() {
    Papa.parse(pasteText, {
      header: true, skipEmptyLines: true,
      complete: r => processRows(r.data as Record<string, string>[]),
    });
  }

  function setCategory(i: number, cat: string) {
    setRows(rows.map((r, idx) => idx === i ? { ...r, category: cat, matched: true } : r));
  }

  async function saveRule(description: string, category: string) {
    const pattern = description.slice(0, 20);
    const existing = await db.importRules.where('pattern').equals(pattern).first();
    if (!existing) {
      const maxPriority = (await db.importRules.toArray()).reduce((m, r) => Math.max(m, r.priority), 0);
      await db.importRules.add({ pattern, category, priority: maxPriority + 1 });
    }
  }

  async function handleSave() {
    setSaving(true);
    for (const row of rows) {
      if (!row.category) continue;
      await db.expenses.add({
        date: row.date,
        person,
        category: row.category,
        amount: row.amount,
        description: row.description,
        createdAt: new Date().toISOString(),
      });
    }
    setSaving(false);
    onDone();
  }

  if (step === 'upload') {
    return (
      <div className="space-y-5">
        <div>
          <label className="label">Import as Person</label>
          <select value={person} onChange={e => setPerson(e.target.value as Person)} className="input">
            <option value="person1">{personName('person1')}</option>
            <option value="person2">{personName('person2')}</option>
          </select>
        </div>

        <div
          className="border-2 border-dashed border-indigo-200 rounded-2xl p-8 text-center cursor-pointer hover:border-indigo-400 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mx-auto mb-2 text-indigo-400" size={32} />
          <p className="text-slate-600 font-medium">Tap to upload CSV</p>
          <p className="text-xs text-slate-400 mt-1">Bank statement in CSV format</p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </div>

        <div className="text-slate-400 text-center text-sm">— or paste CSV text —</div>

        <div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={5}
            placeholder="Paste CSV rows here (first row = headers)..."
            className="input font-mono text-xs resize-none"
          />
          <button onClick={handlePaste} disabled={!pasteText.trim()} className="btn-primary w-full mt-2">
            Process Pasted Text
          </button>
        </div>
      </div>
    );
  }

  const unmatched = rows.filter(r => !r.category);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl text-sm">
        <Check size={16} className="text-emerald-500 shrink-0" />
        <span className="text-slate-600">{rows.length - unmatched.length} matched · </span>
        {unmatched.length > 0 && (
          <span className="text-amber-600 flex items-center gap-1">
            <AlertCircle size={14} /> {unmatched.length} need category
          </span>
        )}
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {rows.map((row, i) => (
          <div key={i} className={`p-3 rounded-xl border text-sm ${row.matched ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex justify-between mb-1">
              <span className="text-slate-400 text-xs">{row.date}</span>
              <span className="font-semibold text-slate-800">₹{row.amount.toLocaleString('en-IN')}</span>
            </div>
            <p className="text-slate-700 truncate mb-2">{row.description}</p>
            <div className="flex gap-2 items-center">
              <select
                value={row.category ?? ''}
                onChange={async e => {
                  setCategory(i, e.target.value);
                  if (!row.matched) await saveRule(row.description, e.target.value);
                }}
                className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">— select category —</option>
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
              {row.matched && <Check size={16} className="text-emerald-500 shrink-0" />}
            </div>
          </div>
        ))}
      </div>

      <button onClick={handleSave} disabled={saving || rows.every(r => !r.category)}
        className="btn-primary w-full">
        {saving ? 'Saving…' : `Save ${rows.filter(r => r.category).length} Expenses`}
      </button>
    </div>
  );
}
