import { describe, it, expect } from 'vitest';
import { computeFIFO } from './fifo';
import type { InvestmentTx } from '../db/types';

function buy(id: number, date: string, units: number, price: number): InvestmentTx {
  return { id, date, person: 'person1', type: 'BUY', assetClass: 'Test', holdingName: 'TEST', units, pricePerUnit: price, amount: units * price, createdAt: date };
}
function sell(id: number, date: string, units: number, price: number): InvestmentTx {
  return { id, date, person: 'person1', type: 'SELL', assetClass: 'Test', holdingName: 'TEST', units, pricePerUnit: price, amount: units * price, createdAt: date };
}
function income(id: number, date: string, amount: number): InvestmentTx {
  return { id, date, person: 'person1', type: 'INCOME', assetClass: 'Test', holdingName: 'TEST', units: 0, pricePerUnit: 0, amount, createdAt: date };
}

describe('FIFO – core cases', () => {
  it('canonical case: buy 100@500 + buy 90@560, sell 120@600 → realized gain = ₹10,800', () => {
    const txs = [
      buy(1, '2024-01-01', 100, 500),
      buy(2, '2024-01-02', 90, 560),
      sell(3, '2024-01-03', 120, 600),
    ];
    const r = computeFIFO(txs);
    // proceeds = 120×600 = 72,000
    // cost = 100×500 + 20×560 = 50,000 + 11,200 = 61,200
    // gain  = 72,000 − 61,200 = 10,800
    expect(r.saleResults).toHaveLength(1);
    expect(r.saleResults[0].realizedGain).toBe(10800);
    expect(r.totalRealizedGain).toBe(10800);
    expect(r.saleResults[0].costBasis).toBe(61200);
    // remaining: 70 units of lot-2 @ 560
    expect(r.remainingUnits).toBe(70);
    expect(r.remainingCostBasis).toBe(70 * 560);
  });

  it('multi-lot: partial profit then partial loss on same sell', () => {
    // buy 50@1000, buy 50@1200
    // sell 60@1100 → consume all 50@1000 (gain +5000) + 10@1200 (loss −1000) = net +4000
    const txs = [
      buy(1, '2024-01-01', 50, 1000),
      buy(2, '2024-01-02', 50, 1200),
      sell(3, '2024-01-03', 60, 1100),
    ];
    const r = computeFIFO(txs);
    expect(r.saleResults[0].realizedGain).toBe(4000);
    expect(r.remainingUnits).toBe(40);
    expect(r.remainingCostBasis).toBe(40 * 1200);
  });

  it('two sells: first profit, then loss', () => {
    // buy 100@500
    // sell 40@600 → gain  = 40×100 = 4,000
    // sell 60@450 → loss  = 60×(−50) = −3,000
    const txs = [
      buy(1, '2024-01-01', 100, 500),
      sell(2, '2024-01-02', 40, 600),
      sell(3, '2024-01-03', 60, 450),
    ];
    const r = computeFIFO(txs);
    expect(r.saleResults[0].realizedGain).toBe(4000);
    expect(r.saleResults[1].realizedGain).toBe(-3000);
    expect(r.totalRealizedGain).toBe(1000);
    expect(r.remainingUnits).toBe(0);
    expect(r.remainingCostBasis).toBe(0);
  });

  it('income is tracked separately and does not affect lots', () => {
    const txs = [
      buy(1, '2024-01-01', 100, 500),
      income(2, '2024-01-02', 5000),
    ];
    const r = computeFIFO(txs);
    expect(r.totalIncome).toBe(5000);
    expect(r.totalRealizedGain).toBe(0);
    expect(r.remainingUnits).toBe(100);
  });

  it('empty transactions returns zero result', () => {
    const r = computeFIFO([]);
    expect(r.totalRealizedGain).toBe(0);
    expect(r.remainingUnits).toBe(0);
    expect(r.saleResults).toHaveLength(0);
    expect(r.totalBuyAmount).toBe(0);
  });

  it('lots consumed in FIFO order even when buys are on same date (lower id first)', () => {
    // Both buys on same date; id determines order
    const txs = [
      buy(2, '2024-01-01', 10, 200),  // id=2 → second lot
      buy(1, '2024-01-01', 10, 100),  // id=1 → first lot
      sell(3, '2024-01-02', 10, 150),
    ];
    const r = computeFIFO(txs);
    // Should consume lot with id=1 (price=100), not id=2 (price=200)
    expect(r.saleResults[0].costBasis).toBe(10 * 100);
    expect(r.saleResults[0].realizedGain).toBe(10 * 150 - 10 * 100); // 500
  });

  it('totalBuyAmount accumulates all buy amounts', () => {
    const txs = [buy(1, '2024-01-01', 100, 500), buy(2, '2024-01-02', 50, 600)];
    const r = computeFIFO(txs);
    expect(r.totalBuyAmount).toBe(100 * 500 + 50 * 600);
    expect(r.totalBought).toBe(150);
  });
});
