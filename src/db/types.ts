export type Person = 'person1' | 'person2';
export type TxType = 'BUY' | 'SELL' | 'INCOME';

export interface Settings {
  id?: number;
  person1Name: string;
  person2Name: string;
  assetClasses: string[];
  expenseCategories: string[];
  useIndianFY: boolean;
}

export interface InvestmentTx {
  id?: number;
  date: string;           // ISO date string YYYY-MM-DD
  person: Person;
  type: TxType;
  assetClass: string;
  holdingName: string;
  units: number;
  pricePerUnit: number;
  amount: number;         // For BUY/SELL = units*price; for INCOME = cash amount
  linkedTxId?: number;    // Reinvestment link: SELL→BUY or INCOME→BUY
  note?: string;
  reinvested?: boolean;   // For INCOME: was it reinvested?
  createdAt: string;
}

export interface ExpenseTx {
  id?: number;
  date: string;
  person: Person;
  category: string;
  amount: number;
  description: string;
  note?: string;
  createdAt: string;
}

export interface ImportRule {
  id?: number;
  pattern: string;       // case-insensitive substring
  category: string;
  priority: number;      // higher = checked first
}

export interface HoldingValue {
  id?: number;
  key: string;           // `${holdingName}:::${person}`
  holdingName: string;
  person: Person;
  currentMarketValue: number;
  lastUpdated: string;
}

// Computed from FIFO, not stored
export interface HoldingSummary {
  holdingName: string;
  person: Person;
  assetClass: string;
  remainingUnits: number;
  remainingCostBasis: number;
  avgCostPerUnit: number;
  totalBuyAmount: number;
  realizedGain: number;
  totalIncome: number;
  currentMarketValue: number;
  unrealizedGain: number;
  returnPct: number;
}
