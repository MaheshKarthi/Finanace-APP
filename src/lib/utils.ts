export const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const INR2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmt(n: number) { return INR.format(n); }
export function fmt2(n: number) { return INR2.format(n); }
export function fmtUnits(n: number) { return n % 1 === 0 ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 4 }); }
export function fmtPct(n: number) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function fyLabel(date: string, useIndianFY: boolean): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-based
  if (!useIndianFY) return String(year);
  // Indian FY: Apr (3) – Mar (2)
  return month >= 3 ? `FY ${year}-${String(year + 1).slice(2)}` : `FY ${year - 1}-${String(year).slice(2)}`;
}

export function monthKey(date: string) { return date.slice(0, 7); } // "YYYY-MM"
export function monthLabel(key: string) {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1);
  return d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
}

export function clsx(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(' ');
}

export function gainColor(n: number) {
  if (n > 0) return 'text-emerald-600';
  if (n < 0) return 'text-rose-600';
  return 'text-slate-500';
}
