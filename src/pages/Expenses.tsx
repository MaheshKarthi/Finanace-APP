import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useApp } from '../context/AppContext';
import { fmt, monthKey, monthLabel } from '../lib/utils';
import PersonFilter from '../components/PersonFilter';
import Modal from '../components/Modal';
import ExpenseForm from '../components/ExpenseForm';
import CsvImport from '../components/CsvImport';
import type { ExpenseTx, Person } from '../db/types';
import { Plus, Upload, Pencil, Trash2 } from 'lucide-react';
import { afterWrite } from '../context/AppContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Expenses() {
  const { personFilter, personName, settings } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<ExpenseTx | undefined>();
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const allExp = useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), []);
  if (!allExp) return <div className="p-6 text-slate-400">Loading…</div>;

  const persons: Person[] = personFilter === 'all' ? ['person1', 'person2'] : [personFilter as Person];
  const categories = settings?.expenseCategories ?? [];

  const filtered = allExp.filter(e =>
    persons.includes(e.person) &&
    (selectedMonth === '' || monthKey(e.date) === selectedMonth) &&
    (selectedCategory === '' || e.category === selectedCategory)
  );

  // Monthly summary
  const monthTotals: Record<string, number> = {};
  for (const e of allExp) {
    if (!persons.includes(e.person)) continue;
    if (e.category === 'Income') continue;
    const mk = monthKey(e.date);
    monthTotals[mk] = (monthTotals[mk] ?? 0) + e.amount;
  }
  const months = Object.keys(monthTotals).sort().reverse().slice(0, 12);

  // Category breakdown for selected month
  const catTotals: Record<string, number> = {};
  for (const e of filtered) {
    if (e.category === 'Income') continue;
    catTotals[e.category] = (catTotals[e.category] ?? 0) + e.amount;
  }
  const catData = Object.entries(catTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([name, amount]) => ({ name, amount }));

  const totalFiltered = filtered.filter(e => e.category !== 'Income').reduce((s, e) => s + e.amount, 0);
  const totalIncome = filtered.filter(e => e.category === 'Income').reduce((s, e) => s + e.amount, 0);

  async function deleteExp(e: ExpenseTx) {
    if (!confirm(`Delete "${e.description}"?`)) return;
    await db.expenses.delete(e.id!);
    afterWrite();
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold text-slate-800">Expenses</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)}
            className="bg-white border border-slate-200 text-slate-600 rounded-xl p-2.5 shadow-sm">
            <Upload size={20} />
          </button>
          <button onClick={() => { setEditing(undefined); setShowForm(true); }}
            className="bg-indigo-600 text-white rounded-xl p-2.5 shadow-sm active:scale-95 transition-transform">
            <Plus size={20} />
          </button>
        </div>
      </div>

      <PersonFilter />

      {/* Filters */}
      <div className="flex gap-2">
        <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
          className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-600">
          <option value="">All months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
          className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-600">
          <option value="">All categories</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Summary */}
      <div className="flex gap-3">
        <div className="flex-1 bg-rose-50 rounded-2xl p-4">
          <p className="text-xs text-rose-400">Expenses</p>
          <p className="text-lg font-bold text-rose-700">{fmt(totalFiltered)}</p>
        </div>
        {totalIncome > 0 && (
          <div className="flex-1 bg-emerald-50 rounded-2xl p-4">
            <p className="text-xs text-emerald-400">Income</p>
            <p className="text-lg font-bold text-emerald-700">{fmt(totalIncome)}</p>
          </div>
        )}
      </div>

      {/* Category bar chart */}
      {catData.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">By Category</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={catData} layout="vertical" margin={{ top: 0, right: 50, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
              <Bar dataKey="amount" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Transaction list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <p className="text-slate-400 text-sm">No expenses found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => (
            <div key={e.id} className="bg-white rounded-2xl shadow-sm">
              <div className="flex items-center gap-3 p-4">
                <div className={`w-2 h-2 rounded-full shrink-0 ${e.category === 'Income' ? 'bg-emerald-400' : 'bg-indigo-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{e.description}</p>
                  <p className="text-xs text-slate-400">{e.date} · {e.category} · {personName(e.person as Person)}</p>
                </div>
                <p className={`text-sm font-bold shrink-0 ${e.category === 'Income' ? 'text-emerald-600' : 'text-slate-800'}`}>{fmt(e.amount)}</p>
              </div>
              <div className="flex border-t border-slate-100">
                <button onClick={() => { setEditing(e); setShowForm(true); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-slate-400 hover:text-indigo-600 transition-colors">
                  <Pencil size={13} /> Edit
                </button>
                <button onClick={() => deleteExp(e)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-slate-400 hover:text-rose-500 transition-colors border-l border-slate-100">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title={editing ? 'Edit Expense' : 'New Expense'} onClose={() => setShowForm(false)}>
          <ExpenseForm existing={editing} onDone={() => setShowForm(false)} />
        </Modal>
      )}
      {showImport && (
        <Modal title="Import Statement" onClose={() => setShowImport(false)}>
          <CsvImport onDone={() => setShowImport(false)} />
        </Modal>
      )}
    </div>
  );
}
