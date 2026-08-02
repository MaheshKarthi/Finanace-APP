import Dexie, { type Table } from 'dexie';
import type { Settings, InvestmentTx, ExpenseTx, ImportRule, HoldingValue } from './types';

export class AppDB extends Dexie {
  settings!: Table<Settings>;
  investments!: Table<InvestmentTx>;
  expenses!: Table<ExpenseTx>;
  importRules!: Table<ImportRule>;
  holdingValues!: Table<HoldingValue>;

  constructor() {
    super('FinanceApp');
    this.version(1).stores({
      settings: '++id',
      investments: '++id, date, person, type, holdingName, assetClass',
      expenses: '++id, date, person, category',
      importRules: '++id, priority',
      holdingValues: '++id, &key, person',
    });
  }
}

export const db = new AppDB();

export async function initDB() {
  const count = await db.settings.count();
  if (count === 0) {
    await db.settings.add({
      person1Name: 'Mahesh',
      person2Name: 'Wife',
      assetClasses: ['Mutual Funds/SIP', 'US Stocks', 'Gold', 'Bonds', 'EPF/PPF', 'FD/Cash'],
      expenseCategories: [
        'Food', 'Groceries', 'Fuel', 'Utilities', 'EMI', 'Shopping',
        'Healthcare', 'Entertainment', 'Education', 'Travel', 'Rent',
        'Insurance', 'Income', 'Other',
      ],
      useIndianFY: true,
    });
  }
}
