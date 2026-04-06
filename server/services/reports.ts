import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  AccountType,
  BalanceSheetReportData,
  DonorDetailReportData,
  DonorDetailReportTransaction,
  DonorSummaryReportData,
  LedgerReportData,
  PLReportData,
  TrialBalanceReportData,
} from '@shared/contracts';

const db = require('../db') as Knex;

type Numeric = string | number;

interface DateRangeArgs {
  from?: string;
  to?: string;
  fundId?: string | null;
}

interface BalanceSheetArgs {
  asOf?: string;
  fundId?: string | null;
}

interface LedgerArgs extends DateRangeArgs {
  accountId?: string | null;
}

interface DonorDetailArgs extends DateRangeArgs {
  contactId?: string | null;
}

interface BaseQueryArgs extends DateRangeArgs {
  asOf?: string;
}

interface PLRow {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  total_debit: Numeric;
  total_credit: Numeric;
}

interface BalanceSheetRow extends PLRow {}

interface AccountRow {
  id: number;
  code: string;
  name: string;
  type: AccountType;
}

interface LedgerEntryRow {
  date: string | Date;
  description: string;
  reference_no: string | null;
  fund_name: string;
  debit: Numeric;
  credit: Numeric;
  memo: string | null;
}

interface PriorBalanceRow {
  total_debit: Numeric;
  total_credit: Numeric;
}

interface TrialBalanceRow {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  total_debit: Numeric;
  total_credit: Numeric;
}

interface DonorSummaryRow {
  contact_id: number;
  contact_name: string;
  contact_type: 'DONOR' | 'PAYEE' | 'BOTH';
  contact_class: 'INDIVIDUAL' | 'HOUSEHOLD';
  total: Numeric;
  transaction_count: string | number;
}

interface DonorSummaryAnonRow {
  total: Numeric;
  transaction_count: string | number;
}

interface ContactRow {
  id: number;
  name: string;
  contact_class: 'INDIVIDUAL' | 'HOUSEHOLD';
}

interface ContactIdRow {
  id: number;
}

interface DonationQueryRow {
  transaction_id: number;
  amount: Numeric;
  date: string | Date;
  description: string;
  reference_no: string | null;
  account_code: string;
  account_name: string;
  fund_name: string;
  memo: string | null;
}

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);
const asDateString = (value: string | Date) => (value instanceof Date ? value.toISOString() : String(value));

function baseQuery({ from, to, asOf, fundId }: BaseQueryArgs = {}): Knex.QueryBuilder {
  const query = db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .join('funds as f', 'f.id', 'je.fund_id');

  if (from) query.where('t.date', '>=', from);
  if (to) query.where('t.date', '<=', to);
  if (asOf) query.where('t.date', '<=', asOf);
  if (fundId) query.where('je.fund_id', fundId);

  return query;
}

async function getPL({ from, to, fundId }: DateRangeArgs): Promise<PLReportData> {
  const rows = await baseQuery({ from, to, fundId })
    .whereIn('a.type', ['INCOME', 'EXPENSE'])
    .select(
      'a.id',
      'a.code',
      'a.name',
      'a.type',
      db.raw('COALESCE(SUM(je.debit),  0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('a.id', 'a.code', 'a.name', 'a.type')
    .orderBy('a.code', 'asc') as PLRow[];

  const income: PLReportData['income'] = [];
  const expenses: PLReportData['expenses'] = [];

  let totalIncome = dec(0);
  let totalExpenses = dec(0);

  for (const row of rows) {
    const debit = dec(row.total_debit);
    const credit = dec(row.total_credit);

    if (row.type === 'INCOME') {
      const net = credit.minus(debit);
      totalIncome = totalIncome.plus(net);
      income.push({
        id: row.id,
        code: row.code,
        name: row.name,
        amount: parseFloat(net.toFixed(2)),
      });
    } else {
      const net = debit.minus(credit);
      totalExpenses = totalExpenses.plus(net);
      expenses.push({
        id: row.id,
        code: row.code,
        name: row.name,
        amount: parseFloat(net.toFixed(2)),
      });
    }
  }

  const net = totalIncome.minus(totalExpenses);

  return {
    income,
    expenses,
    total_income: parseFloat(totalIncome.toFixed(2)),
    total_expenses: parseFloat(totalExpenses.toFixed(2)),
    net_surplus: parseFloat(net.toFixed(2)),
  };
}

async function getBalanceSheet({ asOf, fundId }: BalanceSheetArgs): Promise<BalanceSheetReportData> {
  const rows = await baseQuery({ asOf, fundId })
    .whereIn('a.type', ['ASSET', 'LIABILITY', 'EQUITY'])
    .select(
      'a.id',
      'a.code',
      'a.name',
      'a.type',
      db.raw('COALESCE(SUM(je.debit),  0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('a.id', 'a.code', 'a.name', 'a.type')
    .orderBy('a.code', 'asc') as BalanceSheetRow[];

  const assets: BalanceSheetReportData['assets'] = [];
  const liabilities: BalanceSheetReportData['liabilities'] = [];
  const equity: BalanceSheetReportData['equity'] = [];

  let totalAssets = dec(0);
  let totalLiabilities = dec(0);
  let totalEquity = dec(0);

  for (const row of rows) {
    const debit = dec(row.total_debit);
    const credit = dec(row.total_credit);

    if (row.type === 'ASSET') {
      const balance = debit.minus(credit);
      totalAssets = totalAssets.plus(balance);
      assets.push({
        id: row.id,
        code: row.code,
        name: row.name,
        balance: parseFloat(balance.toFixed(2)),
      });
    } else if (row.type === 'LIABILITY') {
      const balance = credit.minus(debit);
      totalLiabilities = totalLiabilities.plus(balance);
      liabilities.push({
        id: row.id,
        code: row.code,
        name: row.name,
        balance: parseFloat(balance.toFixed(2)),
      });
    } else {
      const balance = credit.minus(debit);
      totalEquity = totalEquity.plus(balance);
      equity.push({
        id: row.id,
        code: row.code,
        name: row.name,
        balance: parseFloat(balance.toFixed(2)),
      });
    }
  }

  const totalLiabilitiesAndEquity = totalLiabilities.plus(totalEquity);

  return {
    assets,
    liabilities,
    equity,
    total_assets: parseFloat(totalAssets.toFixed(2)),
    total_liabilities: parseFloat(totalLiabilities.toFixed(2)),
    total_equity: parseFloat(totalEquity.toFixed(2)),
    total_liabilities_and_equity: parseFloat(totalLiabilitiesAndEquity.toFixed(2)),
    is_balanced: totalAssets.equals(totalLiabilitiesAndEquity),
  };
}

async function getLedger({ from, to, fundId, accountId }: LedgerArgs): Promise<LedgerReportData> {
  const accountQuery = db('accounts as a')
    .where('a.is_active', true)
    .orderBy('a.code', 'asc');

  if (accountId) {
    accountQuery.where('a.id', accountId);
  }

  const accounts = await accountQuery.select('a.id', 'a.code', 'a.name', 'a.type') as AccountRow[];
  const ledger: LedgerReportData['ledger'] = [];

  for (const account of accounts) {
    const entries = await baseQuery({ from, to, fundId })
      .where('je.account_id', account.id)
      .select(
        't.date',
        't.description',
        't.reference_no',
        'f.name as fund_name',
        'je.debit',
        'je.credit',
        'je.memo'
      )
      .orderBy('t.date', 'asc')
      .orderBy('je.id', 'asc') as LedgerEntryRow[];

    if (entries.length === 0 && !accountId) continue;

    let openingBalance = dec(0);
    if (from) {
      const prior = await db('journal_entries as je')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .where('je.account_id', account.id)
        .where('t.date', '<', from)
        .modify((query) => {
          if (fundId) query.where('je.fund_id', fundId);
        })
        .select(
          db.raw('COALESCE(SUM(je.debit),  0) AS total_debit'),
          db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
        )
        .first() as PriorBalanceRow | undefined;

      if (account.type === 'ASSET' || account.type === 'EXPENSE') {
        openingBalance = dec(prior?.total_debit).minus(dec(prior?.total_credit));
      } else {
        openingBalance = dec(prior?.total_credit).minus(dec(prior?.total_debit));
      }
    }

    let runningBalance = openingBalance;
    const rows = entries.map((entry) => {
      const debit = dec(entry.debit);
      const credit = dec(entry.credit);

      if (account.type === 'ASSET' || account.type === 'EXPENSE') {
        runningBalance = runningBalance.plus(debit).minus(credit);
      } else {
        runningBalance = runningBalance.plus(credit).minus(debit);
      }

      return {
        date: asDateString(entry.date),
        description: entry.description,
        reference_no: entry.reference_no,
        fund_name: entry.fund_name,
        debit: parseFloat(dec(entry.debit).toFixed(2)),
        credit: parseFloat(dec(entry.credit).toFixed(2)),
        memo: entry.memo,
        balance: parseFloat(runningBalance.toFixed(2)),
      };
    });

    ledger.push({
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
      },
      opening_balance: parseFloat(openingBalance.toFixed(2)),
      closing_balance: parseFloat(runningBalance.toFixed(2)),
      rows,
    });
  }

  return { ledger };
}

async function getTrialBalance({ from, to, fundId }: DateRangeArgs): Promise<TrialBalanceReportData> {
  const rows = await baseQuery({ from, to, fundId })
    .select(
      'a.id',
      'a.code',
      'a.name',
      'a.type',
      db.raw('COALESCE(SUM(je.debit),  0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('a.id', 'a.code', 'a.name', 'a.type')
    .orderBy('a.code', 'asc') as TrialBalanceRow[];

  let grandDebit = dec(0);
  let grandCredit = dec(0);

  const accounts = rows.map((row) => {
    const debit = dec(row.total_debit);
    const credit = dec(row.total_credit);
    grandDebit = grandDebit.plus(debit);
    grandCredit = grandCredit.plus(credit);

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      total_debit: parseFloat(debit.toFixed(2)),
      total_credit: parseFloat(credit.toFixed(2)),
    };
  });

  return {
    accounts,
    grand_total_debit: parseFloat(grandDebit.toFixed(2)),
    grand_total_credit: parseFloat(grandCredit.toFixed(2)),
    is_balanced: grandDebit.equals(grandCredit),
  };
}

async function getDonorSummary({ from, to, fundId }: DateRangeArgs): Promise<DonorSummaryReportData> {
  const rows = await db('transactions as t')
    .join('journal_entries as je', 'je.transaction_id', 't.id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .join('contacts as c', 'c.id', 'je.contact_id')
    .where('a.type', 'INCOME')
    .where('je.credit', '>', 0)
    .whereNotNull('je.contact_id')
    .modify((query) => {
      if (from) query.where('t.date', '>=', from);
      if (to) query.where('t.date', '<=', to);
      if (fundId) query.where('je.fund_id', fundId);
    })
    .select(
      'c.id as contact_id',
      'c.name as contact_name',
      'c.type as contact_type',
      'c.contact_class as contact_class',
      db.raw('COALESCE(SUM(je.credit), 0) AS total'),
      db.raw('COUNT(DISTINCT t.id) AS transaction_count')
    )
    .groupBy('c.id', 'c.name', 'c.type', 'c.contact_class')
    .orderBy('total', 'desc') as DonorSummaryRow[];

  const anonRow = await db('transactions as t')
    .join('journal_entries as je', 'je.transaction_id', 't.id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('a.type', 'INCOME')
    .where('je.credit', '>', 0)
    .whereNull('je.contact_id')
    .modify((query) => {
      if (from) query.where('t.date', '>=', from);
      if (to) query.where('t.date', '<=', to);
      if (fundId) query.where('je.fund_id', fundId);
    })
    .select(
      db.raw('COALESCE(SUM(je.credit), 0) AS total'),
      db.raw('COUNT(DISTINCT t.id) AS transaction_count')
    )
    .first() as DonorSummaryAnonRow | undefined;

  const donors = rows.map((row) => ({
    contact_id: row.contact_id,
    contact_name: row.contact_name,
    contact_type: row.contact_type,
    contact_class: row.contact_class,
    total: parseFloat(dec(row.total).toFixed(2)),
    transaction_count: parseInt(String(row.transaction_count), 10),
  }));

  const grandTotal = donors.reduce((sum, donor) => sum.plus(dec(donor.total)), dec(0));
  const anonTotal = dec(anonRow?.total ?? 0);

  return {
    donors,
    anonymous: {
      total: parseFloat(anonTotal.toFixed(2)),
      transaction_count: parseInt(String(anonRow?.transaction_count ?? 0), 10),
    },
    grand_total: parseFloat(grandTotal.plus(anonTotal).toFixed(2)),
    donor_count: donors.length,
  };
}

async function getDonorDetail({ from, to, fundId, contactId }: DonorDetailArgs): Promise<DonorDetailReportData> {
  const donationQuery = () =>
    db('transactions as t')
      .join('journal_entries as je', 'je.transaction_id', 't.id')
      .join('accounts as a', 'a.id', 'je.account_id')
      .join('funds as f', 'f.id', 'je.fund_id')
      .where('a.type', 'INCOME')
      .where('je.credit', '>', 0)
      .modify((query) => {
        if (from) query.where('t.date', '>=', from);
        if (to) query.where('t.date', '<=', to);
        if (fundId) query.where('je.fund_id', fundId);
      })
      .select(
        't.id as transaction_id',
        't.date',
        't.description',
        't.reference_no',
        'a.code as account_code',
        'a.name as account_name',
        'f.name as fund_name',
        'je.credit as amount',
        'je.memo'
      )
      .orderBy('t.date', 'asc') as Knex.QueryBuilder<DonationQueryRow, DonationQueryRow[]>;

  if (contactId) {
    const contact = await db('contacts').where({ id: contactId }).first() as ContactRow | undefined;
    if (!contact) return { donors: [], anonymous: null, grand_total: 0 };

    const transactions = await donationQuery().where('je.contact_id', contactId) as DonationQueryRow[];
    const total = transactions.reduce((sum, tx) => sum.plus(dec(tx.amount)), dec(0));

    return {
      donors: [
        {
          contact_id: contact.id,
          contact_name: contact.name,
          contact_class: contact.contact_class,
          total: parseFloat(total.toFixed(2)),
          transactions: transactions.map((tx) => ({
            ...tx,
            date: asDateString(tx.date),
            amount: parseFloat(dec(tx.amount).toFixed(2)),
          })),
        },
      ],
      anonymous: null,
      grand_total: parseFloat(total.toFixed(2)),
    };
  }

  const contactIds = await donationQuery()
    .whereNotNull('je.contact_id')
    .distinct('je.contact_id as id') as ContactIdRow[];

  const donors: DonorDetailReportData['donors'] = [];
  let grandTotal = dec(0);

  // TODO: Optimize donor-detail collection to avoid per-contact N+1 queries.
  for (const { id } of contactIds) {
    const contact = await db('contacts').where({ id }).first() as ContactRow | undefined;
    if (!contact) continue;

    const transactions = await donationQuery().where('je.contact_id', id) as DonationQueryRow[];
    const total = transactions.reduce((sum, tx) => sum.plus(dec(tx.amount)), dec(0));
    grandTotal = grandTotal.plus(total);

    donors.push({
      contact_id: contact.id,
      contact_name: contact.name,
      contact_class: contact.contact_class,
      total: parseFloat(total.toFixed(2)),
      transactions: transactions.map((tx) => ({
        ...tx,
        date: asDateString(tx.date),
        amount: parseFloat(dec(tx.amount).toFixed(2)),
      })),
    });
  }

  donors.sort((a, b) => b.total - a.total);

  const anonTransactions = await donationQuery().whereNull('je.contact_id') as DonationQueryRow[];
  const anonTotal = anonTransactions.reduce((sum, tx) => sum.plus(dec(tx.amount)), dec(0));
  grandTotal = grandTotal.plus(anonTotal);

  return {
    donors,
    anonymous: {
      total: parseFloat(anonTotal.toFixed(2)),
      transactions: anonTransactions.map((tx) => ({
        ...tx,
        date: asDateString(tx.date),
        amount: parseFloat(dec(tx.amount).toFixed(2)),
      })),
    },
    grand_total: parseFloat(grandTotal.toFixed(2)),
  };
}

export = {
  getPL,
  getBalanceSheet,
  getLedger,
  getTrialBalance,
  getDonorSummary,
  getDonorDetail,
};
