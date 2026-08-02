import type { InvestmentTx } from '../db/types';

export interface Lot {
  txId: number;
  date: string;
  originalUnits: number;
  pricePerUnit: number;
  remainingUnits: number;
}

export interface LotConsumed {
  txId: number;
  units: number;
  cost: number;
}

export interface SaleResult {
  sellTxId: number;
  sellDate: string;
  proceeds: number;
  costBasis: number;
  realizedGain: number;
  lotsConsumed: LotConsumed[];
}

export interface FIFOResult {
  remainingLots: Lot[];
  saleResults: SaleResult[];
  totalRealizedGain: number;
  totalIncome: number;
  remainingUnits: number;
  remainingCostBasis: number;
  totalBought: number;
  totalBuyAmount: number;
}

/**
 * Computes FIFO realized gains for a set of transactions for a single holding+person.
 * Transactions are sorted by date (then by id for same-day ordering).
 * Each SELL consumes the oldest BUY lots first.
 */
export function computeFIFO(transactions: InvestmentTx[]): FIFOResult {
  const sorted = [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.id ?? 0) - (b.id ?? 0);
  });

  const lots: Lot[] = [];
  const saleResults: SaleResult[] = [];
  let totalRealizedGain = 0;
  let totalIncome = 0;
  let totalBought = 0;
  let totalBuyAmount = 0;

  for (const tx of sorted) {
    if (tx.type === 'BUY') {
      lots.push({
        txId: tx.id!,
        date: tx.date,
        originalUnits: tx.units,
        pricePerUnit: tx.pricePerUnit,
        remainingUnits: tx.units,
      });
      totalBought += tx.units;
      totalBuyAmount += tx.amount;
    } else if (tx.type === 'SELL') {
      let unitsToSell = tx.units;
      const proceeds = tx.amount;
      let costBasis = 0;
      const lotsConsumed: LotConsumed[] = [];

      for (const lot of lots) {
        if (unitsToSell <= 0) break;
        if (lot.remainingUnits <= 0) continue;

        const consumed = Math.min(lot.remainingUnits, unitsToSell);
        const cost = consumed * lot.pricePerUnit;
        costBasis += cost;
        lot.remainingUnits -= consumed;
        unitsToSell -= consumed;
        lotsConsumed.push({ txId: lot.txId, units: consumed, cost });
      }

      const realizedGain = proceeds - costBasis;
      totalRealizedGain += realizedGain;
      saleResults.push({
        sellTxId: tx.id!,
        sellDate: tx.date,
        proceeds,
        costBasis,
        realizedGain,
        lotsConsumed,
      });
    } else if (tx.type === 'INCOME') {
      totalIncome += tx.amount;
    }
  }

  const remainingLots = lots.filter(l => l.remainingUnits > 0);
  const remainingUnits = remainingLots.reduce((s, l) => s + l.remainingUnits, 0);
  const remainingCostBasis = remainingLots.reduce((s, l) => s + l.remainingUnits * l.pricePerUnit, 0);

  return {
    remainingLots,
    saleResults,
    totalRealizedGain,
    totalIncome,
    remainingUnits,
    remainingCostBasis,
    totalBought,
    totalBuyAmount,
  };
}
