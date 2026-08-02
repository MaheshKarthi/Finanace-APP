import { useState, useEffect } from 'react';
import { db } from '../db/db';
import { useApp } from '../context/AppContext';
import type { InvestmentTx, Person, TxType } from '../db/types';
import { today } from '../lib/utils';
import { useLiveQuery } from 'dexie-react-hooks';

interface Props {
  existing?: InvestmentTx;
  onDone: () => void;
}

export default function InvestmentForm({ existing, onDone }: Props) {
  const { settings, personName } = useApp();
  const assetClasses = settings?.assetClasses ?? [];

  const allTx = useLiveQuery(() => db.investments.orderBy('date').reverse().limit(200).toArray(), []);
  const holdingNames = [...new Set(allTx?.map(t => t.holdingName) ?? [])].sort();

  const [form, setForm] = useState({
    date: existing?.date ?? today(),
    person: (existing?.person ?? 'person1') as Person,
    type: (existing?.type ?? 'BUY') as TxType,
    assetClass: existing?.assetClass ?? (assetClasses[0] ?? ''),
    holdingName: existing?.holdingName ?? '',
    units: existing?.units != null ? String(existing.units) : '',
    pricePerUnit: existing?.pricePerUnit != null ? String(existing.pricePerUnit) : '',
    amount: existing?.amount != null ? String(existing.amount) : '',
    linkedTxId: existing?.linkedTxId != null ? String(existing.linkedTxId) : '',
    note: existing?.note ?? '',
    reinvested: existing?.reinvested ?? false,
  });

  // Auto-calculate amount for BUY/SELL
  useEffect(() => {
    if (form.type !== 'INCOME' && form.units && form.pricePerUnit) {
      const a = parseFloat(form.units) * parseFloat(form.pricePerUnit);
      if (!isNaN(a)) setForm(f => ({ ...f, amount: a.toFixed(2) }));
    }
  }, [form.units, form.pricePerUnit, form.type]);

  function set(key: string, val: string | boolean) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Omit<InvestmentTx, 'id'> = {
      date: form.date,
      person: form.person,
      type: form.type,
      assetClass: form.assetClass,
      holdingName: form.holdingName.trim(),
      units: parseFloat(form.units) || 0,
      pricePerUnit: parseFloat(form.pricePerUnit) || 0,
      amount: parseFloat(form.amount) || 0,
      linkedTxId: form.linkedTxId ? parseInt(form.linkedTxId) : undefined,
      note: form.note || undefined,
      reinvested: form.type === 'INCOME' ? form.reinvested : undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (existing?.id != null) {
      await db.investments.update(existing.id, payload);
    } else {
      await db.investments.add(payload);
    }
    onDone();
  }

  const isIncome = form.type === 'INCOME';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Date & Person */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" required value={form.date} onChange={e => set('date', e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Person</label>
          <select value={form.person} onChange={e => set('person', e.target.value)} className="input">
            <option value="person1">{personName('person1')}</option>
            <option value="person2">{personName('person2')}</option>
          </select>
        </div>
      </div>

      {/* Type */}
      <div>
        <label className="label">Type</label>
        <div className="flex gap-2">
          {(['BUY', 'SELL', 'INCOME'] as TxType[]).map(t => (
            <button key={t} type="button"
              onClick={() => set('type', t)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                form.type === t
                  ? t === 'BUY' ? 'bg-emerald-500 text-white border-emerald-500'
                    : t === 'SELL' ? 'bg-rose-500 text-white border-rose-500'
                    : 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* Asset Class */}
      <div>
        <label className="label">Asset Class</label>
        <select value={form.assetClass} onChange={e => set('assetClass', e.target.value)} className="input" required>
          {assetClasses.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Holding Name */}
      <div>
        <label className="label">Holding Name</label>
        <input
          list="holding-names"
          required
          value={form.holdingName}
          onChange={e => set('holdingName', e.target.value)}
          placeholder="e.g. Parag Parikh Flexi Cap"
          className="input"
        />
        <datalist id="holding-names">
          {holdingNames.map(n => <option key={n} value={n} />)}
        </datalist>
      </div>

      {/* Units & Price */}
      {!isIncome && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Units</label>
            <input type="number" step="any" min="0" required value={form.units}
              onChange={e => set('units', e.target.value)} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Price / Unit (₹)</label>
            <input type="number" step="any" min="0" required value={form.pricePerUnit}
              onChange={e => set('pricePerUnit', e.target.value)} className="input" placeholder="0" />
          </div>
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="label">{isIncome ? 'Income Amount (₹)' : 'Amount (₹)'}</label>
        <input type="number" step="any" min="0" required value={form.amount}
          onChange={e => set('amount', e.target.value)}
          className={`input ${!isIncome ? 'bg-slate-50' : ''}`}
          placeholder="Auto-calculated" />
      </div>

      {/* Reinvested (INCOME) */}
      {isIncome && (
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.reinvested} onChange={e => set('reinvested', e.target.checked)}
            className="w-5 h-5 rounded accent-indigo-600" />
          <span className="text-sm text-slate-700">Reinvested (link to a BUY below)</span>
        </label>
      )}

      {/* Linked TX */}
      {(form.type === 'SELL' || (form.type === 'INCOME' && form.reinvested)) && (
        <div>
          <label className="label">{form.type === 'SELL' ? 'Reinvested into BUY (TX #)' : 'Funded BUY (TX #)'}</label>
          <input type="number" value={form.linkedTxId} onChange={e => set('linkedTxId', e.target.value)}
            placeholder="Optional TX ID" className="input" />
        </div>
      )}

      {/* Note */}
      <div>
        <label className="label">Note</label>
        <input type="text" value={form.note} onChange={e => set('note', e.target.value)}
          placeholder="Optional" className="input" />
      </div>

      <button type="submit" className="btn-primary w-full">
        {existing ? 'Update Transaction' : 'Add Transaction'}
      </button>
    </form>
  );
}
