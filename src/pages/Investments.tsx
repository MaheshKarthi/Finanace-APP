import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useApp } from '../context/AppContext';
import { computeFIFO } from '../lib/fifo';
import { fmt, gainColor, today, monthKey } from '../lib/utils';
import PersonFilter from '../components/PersonFilter';
import Modal from '../components/Modal';
import InvestmentForm from '../components/InvestmentForm';
import type { InvestmentTx, Person } from '../db/types';
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown, DollarSign, ChevronDown, ChevronUp } from 'lucide-react';

type FilterType = 'ALL' | 'BUY' | 'SELL' | 'INCOME';

export default function Investments() {
  const { personFilter, personName, settings } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InvestmentTx | undefined>();
  const [filterType, setFilterType] = useState<FilterType>('ALL');
  const [expandSale, setExpandSale] = useState<number | null>(null);
  const [filterMonth, setFilterMonth] = useState('');

  const allTx = useLiveQuery(() => db.investments.orderBy('date').reverse().toArray(), []);
  if (!allTx) return <div className="p-6 text-slate-400">Loading…</div>;

  const persons: Person[] = personFilter === 'all' ? ['person1', 'person2'] : [personFilter as Person];

  // Group by holding for FIFO context
  const byHolding: Record<string, InvestmentTx[]> = {};
  for (const tx of allTx) {
    if (!persons.includes(tx.person)) continue;
    const key = `${tx.holdingName}:::${tx.person}`;
    byHolding[key] ??= [];
    byHolding[key].push(tx);
  }

  // Compute FIFO sale results for all holdings (for P&L annotation on SELL rows)
  const saleGainMap: Record<number, number> = {};
  for (const txs of Object.values(byHolding)) {
    const { saleResults } = computeFIFO(txs);
    for (const s of saleResults) saleGainMap[s.sellTxId] = s.realizedGain;
  }

  // Filter display list
  let displayed = allTx.filter(tx => persons.includes(tx.person));
  if (filterType !== 'ALL') displayed = displayed.filter(tx => tx.type === filterType);
  if (filterMonth) displayed = displayed.filter(tx => monthKey(tx.date) === filterMonth);

  // Running realized P&L total for displayed SELL transactions
  let runningPnL = 0;

  async function deleteTx(tx: InvestmentTx) {
    if (!confirm(`Delete this ${tx.type} transaction for ${tx.holdingName}?`)) return;
    await db.investments.delete(tx.id!);
  }

  const typeIcon = (t: string) =>
    t === 'BUY' ? <TrendingUp size={14} className="text-emerald-500" />
    : t === 'SELL' ? <TrendingDown size={14} className="text-rose-500" />
    : <DollarSign size={14} className="text-amber-500" />;

  const months = [...new Set(allTx.map(tx => monthKey(tx.date)))].sort().reverse().slice(0, 24);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold text-slate-800">Investments</h1>
        <button onClick={() => { setEditing(undefined); setShowForm(true); }}
          className="bg-indigo-600 text-white rounded-xl p-2.5 shadow-sm active:scale-95 transition-transform">
          <Plus size={20} />
        </button>
      </div>

      <PersonFilter />

      {/* Type filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['ALL', 'BUY', 'SELL', 'INCOME'] as FilterType[]).map(t => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              filterType === t ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200'
            }`}>{t}</button>
        ))}
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          className="ml-auto text-xs border border-slate-200 rounded-full px-3 py-1.5 bg-white text-slate-500">
          <option value="">All months</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Transaction list */}
      {displayed.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <p className="text-slate-400 text-sm">No transactions yet.</p>
          <p className="text-slate-300 text-xs mt-1">Tap + to add your first investment.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map(tx => {
            const isSell = tx.type === 'SELL';
            const gain = isSell ? (saleGainMap[tx.id!] ?? 0) : null;
            if (gain != null) runningPnL += gain;
            const isExpanded = expandSale === tx.id;

            return (
              <div key={tx.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-start gap-3 p-4">
                  <div className="mt-0.5">{typeIcon(tx.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 truncate text-sm">{tx.holdingName}</p>
                        <p className="text-xs text-slate-400">{tx.date} · {personName(tx.person)} · {tx.assetClass}</p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="font-bold text-slate-800 text-sm">{fmt(tx.amount)}</p>
                        {tx.type !== 'INCOME' && (
                          <p className="text-xs text-slate-400">{tx.units} × ₹{tx.pricePerUnit.toLocaleString('en-IN')}</p>
                        )}
                      </div>
                    </div>
                    {isSell && gain != null && (
                      <div className="mt-2 flex items-center justify-between">
                        <span className={`text-xs font-semibold ${gainColor(gain)}`}>
                          {gain >= 0 ? '▲' : '▼'} Realized {fmt(Math.abs(gain))}
                        </span>
                        <button onClick={() => setExpandSale(isExpanded ? null : tx.id!)} className="text-slate-300 hover:text-slate-500">
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    )}
                    {tx.type === 'INCOME' && tx.reinvested && (
                      <p className="text-xs text-amber-600 mt-1">↻ Reinvested{tx.linkedTxId ? ` → TX #${tx.linkedTxId}` : ''}</p>
                    )}
                    {tx.linkedTxId && tx.type === 'SELL' && (
                      <p className="text-xs text-indigo-400 mt-1">↻ Reinvested into TX #{tx.linkedTxId}</p>
                    )}
                    {tx.note && <p className="text-xs text-slate-400 mt-1 italic">{tx.note}</p>}
                  </div>
                </div>

                {/* FIFO lots detail */}
                {isExpanded && isSell && (
                  <div className="border-t border-slate-100 px-4 pb-3 pt-2 bg-slate-50">
                    <p className="text-xs font-semibold text-slate-500 mb-1">FIFO Lots Consumed</p>
                    {/* We can't easily show per-lot detail here without re-computing — show summary */}
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Proceeds</span><span>{fmt(tx.amount)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Cost Basis</span><span>{fmt(tx.amount - (gain ?? 0))}</span>
                    </div>
                    <div className={`flex justify-between text-xs font-semibold mt-1 ${gainColor(gain ?? 0)}`}>
                      <span>Realized {gain && gain >= 0 ? 'Gain' : 'Loss'}</span>
                      <span>{fmt(gain ?? 0)}</span>
                    </div>
                  </div>
                )}

                {/* Edit/Delete */}
                <div className="flex border-t border-slate-100">
                  <button onClick={() => { setEditing(tx); setShowForm(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-slate-400 hover:text-indigo-600 transition-colors">
                    <Pencil size={14} /> Edit
                  </button>
                  <button onClick={() => deleteTx(tx)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-slate-400 hover:text-rose-500 transition-colors border-l border-slate-100">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <Modal title={editing ? 'Edit Transaction' : 'New Transaction'} onClose={() => setShowForm(false)}>
          <InvestmentForm existing={editing} onDone={() => setShowForm(false)} />
        </Modal>
      )}
    </div>
  );
}
