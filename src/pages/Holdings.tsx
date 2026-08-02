import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useApp } from '../context/AppContext';
import { computeFIFO } from '../lib/fifo';
import { fmt, fmtUnits, fmtPct, gainColor, today } from '../lib/utils';
import PersonFilter from '../components/PersonFilter';
import type { HoldingSummary, Person } from '../db/types';
import { Pencil, Link } from 'lucide-react';

export default function Holdings() {
  const { personFilter, personName } = useApp();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [mvInput, setMvInput] = useState('');

  const allInv = useLiveQuery(() => db.investments.toArray(), []);
  const allHV = useLiveQuery(() => db.holdingValues.toArray(), []);

  if (!allInv) return <div className="p-6 text-slate-400">Loading…</div>;
  const hvList = allHV ?? [];

  const persons: Person[] = personFilter === 'all' ? ['person1', 'person2'] : [personFilter as Person];

  // Build holdings map
  const holdingMap: Record<string, { txs: typeof allInv; assetClass: string }> = {};
  for (const tx of allInv) {
    if (!persons.includes(tx.person)) continue;
    const key = `${tx.holdingName}:::${tx.person}`;
    if (!holdingMap[key]) holdingMap[key] = { txs: [], assetClass: tx.assetClass };
    holdingMap[key].txs.push(tx);
  }

  const summaries: HoldingSummary[] = [];
  for (const [key, { txs, assetClass }] of Object.entries(holdingMap)) {
    const [holdingName, person] = key.split(':::');
    const fifo = computeFIFO(txs);
    const hv = hvList.find(h => h.key === key);
    const cmv = hv?.currentMarketValue ?? 0;
    const unrealizedGain = cmv - fifo.remainingCostBasis;
    const totalReturn = fifo.totalBuyAmount > 0
      ? ((fifo.totalRealizedGain + unrealizedGain + fifo.totalIncome) / fifo.totalBuyAmount) * 100
      : 0;

    summaries.push({
      holdingName,
      person: person as Person,
      assetClass,
      remainingUnits: fifo.remainingUnits,
      remainingCostBasis: fifo.remainingCostBasis,
      avgCostPerUnit: fifo.remainingUnits > 0 ? fifo.remainingCostBasis / fifo.remainingUnits : 0,
      totalBuyAmount: fifo.totalBuyAmount,
      realizedGain: fifo.totalRealizedGain,
      totalIncome: fifo.totalIncome,
      currentMarketValue: cmv,
      unrealizedGain,
      returnPct: totalReturn,
    });
  }

  summaries.sort((a, b) => b.totalBuyAmount - a.totalBuyAmount);

  async function saveMV(key: string, holdingName: string, person: Person) {
    const val = parseFloat(mvInput);
    if (isNaN(val)) return;
    const existing = hvList.find(h => h.key === key);
    if (existing?.id != null) {
      await db.holdingValues.update(existing.id, { currentMarketValue: val, lastUpdated: today() });
    } else {
      await db.holdingValues.add({ key, holdingName, person, currentMarketValue: val, lastUpdated: today() });
    }
    setEditingKey(null);
  }

  // Reinvestment chains
  const allTxById = Object.fromEntries(allInv.map(tx => [tx.id!, tx]));

  return (
    <div className="p-4 space-y-4">
      <div className="pt-2">
        <h1 className="text-2xl font-bold text-slate-800">Holdings</h1>
        <p className="text-xs text-slate-400 mt-0.5">Market values are manually updated — no live prices</p>
      </div>

      <PersonFilter />

      {summaries.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <p className="text-slate-400 text-sm">No holdings yet. Add BUY transactions to see holdings.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {summaries.map(s => {
            const key = `${s.holdingName}:::${s.person}`;
            const isEditing = editingKey === key;
            const hv = hvList.find(h => h.key === key);

            // Reinvestment chain for this holding
            const sellsLinked = allInv.filter(tx =>
              tx.type === 'SELL' && tx.linkedTxId && persons.includes(tx.person)
              && allTxById[tx.linkedTxId]?.holdingName === s.holdingName
            );

            return (
              <div key={key} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                {/* Header */}
                <div className="p-4 pb-3">
                  <div className="flex justify-between items-start">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-800 text-sm truncate">{s.holdingName}</h3>
                      <p className="text-xs text-slate-400">
                        {s.assetClass} · {personName(s.person as Person)}
                        {hv?.lastUpdated && ` · updated ${hv.lastUpdated}`}
                      </p>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ml-2 shrink-0 ${
                      s.returnPct >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                    }`}>{fmtPct(s.returnPct)}</span>
                  </div>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-px bg-slate-100">
                  <MetricCell label="Units Held" value={fmtUnits(s.remainingUnits)} />
                  <MetricCell label="Avg Cost" value={s.avgCostPerUnit > 0 ? `₹${s.avgCostPerUnit.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'} />
                  <MetricCell label="Cost Basis" value={fmt(s.remainingCostBasis)} />
                  <MetricCell label="Realized P&L" value={fmt(s.realizedGain)} color={gainColor(s.realizedGain)} />
                  <MetricCell label="Income Received" value={fmt(s.totalIncome)} />
                  <MetricCell label="Unrealized P&L" value={s.currentMarketValue > 0 ? fmt(s.unrealizedGain) : '—'} color={s.currentMarketValue > 0 ? gainColor(s.unrealizedGain) : 'text-slate-400'} />
                </div>

                {/* Current Market Value */}
                <div className="p-4 pt-3">
                  {isEditing ? (
                    <div className="flex gap-2">
                      <input
                        type="number" step="any" placeholder="Enter current value (₹)"
                        value={mvInput} onChange={e => setMvInput(e.target.value)}
                        className="flex-1 border border-indigo-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button onClick={() => saveMV(key, s.holdingName, s.person as Person)}
                        className="bg-indigo-600 text-white px-4 rounded-xl text-sm font-semibold">Save</button>
                      <button onClick={() => setEditingKey(null)} className="text-slate-400 px-2 text-sm">✕</button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-400">Current Market Value</p>
                        <p className="text-lg font-bold text-slate-800">
                          {s.currentMarketValue > 0 ? fmt(s.currentMarketValue) : 'Not set'}
                        </p>
                      </div>
                      <button onClick={() => { setEditingKey(key); setMvInput(s.currentMarketValue > 0 ? String(s.currentMarketValue) : ''); }}
                        className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 bg-indigo-50 px-3 py-2 rounded-xl">
                        <Pencil size={13} /> Update
                      </button>
                    </div>
                  )}
                </div>

                {/* Reinvestment chain */}
                {sellsLinked.length > 0 && (
                  <div className="border-t border-slate-100 px-4 py-3 bg-slate-50">
                    <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1"><Link size={12} /> Reinvestment Trail</p>
                    {sellsLinked.map(sell => {
                      const buyTx = sell.linkedTxId ? allTxById[sell.linkedTxId] : null;
                      return (
                        <p key={sell.id} className="text-xs text-slate-600">
                          Sold {sell.date} ({fmt(sell.amount)}) → {buyTx ? `bought ${buyTx.holdingName} on ${buyTx.date}` : `TX #${sell.linkedTxId}`}
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${color ?? 'text-slate-800'}`}>{value}</p>
    </div>
  );
}
