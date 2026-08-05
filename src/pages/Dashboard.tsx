import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useApp } from '../context/AppContext';
import PersonFilter from '../components/PersonFilter';
import { computeFIFO } from '../lib/fifo';
import { fmt, gainColor, fmtPct, monthKey, monthLabel } from '../lib/utils';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import type { Person } from '../db/types';

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#3b82f6', '#f43f5e', '#8b5cf6', '#06b6d4'];

export default function Dashboard() {
  const { personFilter, personName, settings } = useApp();
  const allInv = useLiveQuery(() => db.investments.toArray(), []);
  const allExp = useLiveQuery(() => db.expenses.toArray(), []);
  const allHV = useLiveQuery(() => db.holdingValues.toArray(), []);

  if (allInv === undefined || allExp === undefined || allHV === undefined) {
    return <div className="p-6 text-slate-400">Loading…</div>;
  }

  const persons: Person[] = personFilter === 'all' ? ['person1', 'person2'] : [personFilter];

  // --- Investment summary ---
  const holdings: Record<string, Record<string, typeof allInv>> = {};
  for (const tx of allInv) {
    if (!persons.includes(tx.person)) continue;
    const key = `${tx.holdingName}:::${tx.person}`;
    holdings[key] ??= { txs: [] };
    (holdings[key].txs as typeof allInv).push(tx);
  }

  let totalBuyAmount = 0;
  let totalRealizedGain = 0;
  let totalUnrealizedGain = 0;
  let totalIncome = 0;
  let totalCurrentMV = 0;
  const assetAlloc: Record<string, number> = {};

  for (const [key, { txs }] of Object.entries(holdings)) {
    const [holdingName, person] = key.split(':::');
    const fifo = computeFIFO(txs as typeof allInv);
    const hv = allHV.find(h => h.key === key);
    const cmv = hv?.currentMarketValue ?? 0;

    totalBuyAmount += fifo.totalBuyAmount;
    totalRealizedGain += fifo.totalRealizedGain;
    totalIncome += fifo.totalIncome;
    totalCurrentMV += cmv;
    totalUnrealizedGain += cmv - fifo.remainingCostBasis;

    // Asset class for allocation chart
    const ac = (txs as typeof allInv)[0]?.assetClass ?? 'Other';
    assetAlloc[ac] = (assetAlloc[ac] ?? 0) + (cmv || fifo.remainingCostBasis);

    void holdingName; void person;
  }

  const netWorth = totalCurrentMV;
  const totalPnL = totalRealizedGain + totalUnrealizedGain;

  // --- Expense monthly chart (last 6 months) ---
  const now = new Date();
  const last6: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    last6.push(monthKey(d.toISOString().slice(0, 10)));
  }

  const expByMonth: Record<string, number> = {};
  for (const e of allExp) {
    if (!persons.includes(e.person)) continue;
    if (e.category === 'Income') continue;
    const mk = monthKey(e.date);
    if (last6.includes(mk)) expByMonth[mk] = (expByMonth[mk] ?? 0) + e.amount;
  }
  const monthlyExpData = last6.map(mk => ({ month: monthLabel(mk), amount: expByMonth[mk] ?? 0 }));

  const pieData = Object.entries(assetAlloc)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  const SummaryCard = ({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) => (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <p className="text-xs text-slate-400 font-medium mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      {sub && <p className={`text-xs mt-0.5 font-medium ${subColor ?? 'text-slate-400'}`}>{sub}</p>}
    </div>
  );

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between pt-2">
        <div>
          <p className="text-xs text-slate-400">
            {personFilter === 'all' ? 'Combined Household' : personName(personFilter as Person)}
          </p>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        </div>
      </div>

      <PersonFilter />

      {/* Net Worth Hero */}
      <div className="bg-indigo-600 rounded-2xl p-5 text-white">
        <p className="text-indigo-200 text-sm mb-1">Portfolio Value</p>
        <p className="text-3xl font-bold">{fmt(netWorth)}</p>
        <p className={`text-sm mt-1 ${totalPnL >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
          {totalPnL >= 0 ? '▲' : '▼'} {fmt(Math.abs(totalPnL))} total P&L
        </p>
        <p className="text-indigo-300 text-xs mt-0.5">Prices are manually updated — not live</p>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="Total Invested" value={fmt(totalBuyAmount)} />
        <SummaryCard label="Realized P&L" value={fmt(totalRealizedGain)}
          sub={totalRealizedGain >= 0 ? '▲ Gain' : '▼ Loss'}
          subColor={gainColor(totalRealizedGain)} />
        <SummaryCard label="Unrealized P&L" value={fmt(totalUnrealizedGain)}
          sub={totalUnrealizedGain >= 0 ? '▲ Gain' : '▼ Loss'}
          subColor={gainColor(totalUnrealizedGain)} />
        <SummaryCard label="Dividend / Income" value={fmt(totalIncome)} />
      </div>

      {/* Asset Allocation */}
      {pieData.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Asset Allocation</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={false} labelLine={false}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly Expenses */}
      {monthlyExpData.some(d => d.amount > 0) && (
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Monthly Expenses (6m)</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={monthlyExpData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: unknown) => fmt(Number(v))} />
              <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {pieData.length === 0 && monthlyExpData.every(d => d.amount === 0) && (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <p className="text-slate-400 text-sm">No data yet. Add investments and expenses to see your dashboard.</p>
        </div>
      )}
    </div>
  );
}
