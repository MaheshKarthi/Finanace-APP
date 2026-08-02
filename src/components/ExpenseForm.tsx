import { useState } from 'react';
import { db } from '../db/db';
import { useApp } from '../context/AppContext';
import type { ExpenseTx, Person } from '../db/types';
import { today } from '../lib/utils';

interface Props {
  existing?: ExpenseTx;
  onDone: () => void;
}

export default function ExpenseForm({ existing, onDone }: Props) {
  const { settings, personName } = useApp();
  const categories = settings?.expenseCategories ?? [];

  const [form, setForm] = useState({
    date: existing?.date ?? today(),
    person: (existing?.person ?? 'person1') as Person,
    category: existing?.category ?? (categories[0] ?? ''),
    amount: existing?.amount != null ? String(existing.amount) : '',
    description: existing?.description ?? '',
    note: existing?.note ?? '',
  });

  function set(key: string, val: string) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Omit<ExpenseTx, 'id'> = {
      date: form.date,
      person: form.person as Person,
      category: form.category,
      amount: parseFloat(form.amount),
      description: form.description.trim(),
      note: form.note || undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (existing?.id != null) {
      await db.expenses.update(existing.id, payload);
    } else {
      await db.expenses.add(payload);
    }
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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

      <div>
        <label className="label">Category</label>
        <select value={form.category} onChange={e => set('category', e.target.value)} className="input" required>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div>
        <label className="label">Amount (₹)</label>
        <input type="number" step="any" min="0" required value={form.amount}
          onChange={e => set('amount', e.target.value)} className="input" placeholder="0" />
      </div>

      <div>
        <label className="label">Description</label>
        <input type="text" required value={form.description}
          onChange={e => set('description', e.target.value)} className="input" placeholder="What was this for?" />
      </div>

      <div>
        <label className="label">Note</label>
        <input type="text" value={form.note} onChange={e => set('note', e.target.value)}
          className="input" placeholder="Optional" />
      </div>

      <button type="submit" className="btn-primary w-full">
        {existing ? 'Update Expense' : 'Add Expense'}
      </button>
    </form>
  );
}
