import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  AccountClass,
  AccountType,
  BalanceSheetReportData,
  DonorDetailReportData,
  DonorDetailReportTransaction,
  DonorSummaryReportData,
  LedgerReportData,
  NormalBalanceSide,
  PLReportData,
  ReportDiagnostic,
  TrialBalanceReportData,
} from '@shared/contracts';
import { getDonationLines } from './donorDonations.js';
import { normalizeDateOnly } from '../utils/date.js';

const db = require('../db') as Knex;

type Numeric = string | number;

interface DateRangeArgs {
  from?: string;
  to?: string;
  fundId?: string | null;
  accountIds?: number[] | null;
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

interface TrialBalanceArgs {
  asOf?: string;
  fundId?: string | null;
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
  contact_name: string | null;
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
  account_class: AccountClass | null;
  normal_balance: NormalBalanceSide | null;
}

interface TrialBalanceAggregateRow {
  account_id: number;
  total_debit: Numeric;
  total_credit: Numeric;
}

interface TrialBalancePriorNetRow {
  fund_id: number;
  total_debit: Numeric;
  total_credit: Numeric;
}

interface TrialBalanceFundRow {
  id: number;
  name: string;
  net_asset_account_id: number | null;
  net_asset_code: string | null;
  net_asset_name: string | null;
}

interface DonorSummaryRow {
  contact_id: number;
  contact_name: string;
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

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);
const asDateString = (value: string | Date) => normalizeDateOnly(value);
const ZERO = dec(0);
const UNALLOCATED_SYNTHETIC_EQUITY_CODE = '9999';
const UNALLOCATED_SYNTHETIC_EQUITY_NAME = 'System Unallocated Equity';
const TRIAL_BALANCE_TYPE_ORDER: Record<AccountType, number> = {
  ASSET: 1,
  LIABILITY: 2,
  EQUITY: 3,
  INCOME: 4,
  EXPENSE: 5,
};

const DEFAULT_NORMAL_BALANCE_BY_CLASS: Record<AccountClass, NormalBalanceSide> = {
  ASSET: 'DEBIT',
  CONTRA_ASSET: 'CREDIT',
  LIABILITY: 'CREDIT',
  CONTRA_LIABILITY: 'DEBIT',
  EQUITY: 'CREDIT',
  CONTRA_EQUITY: 'DEBIT',
  INCOME: 'CREDIT',
  CONTRA_INCOME: 'DEBIT',
  EXPENSE: 'DEBIT',
  CONTRA_EXPENSE: 'CREDIT',
};

const DEFAULT_ACCOUNT_CLASS_BY_TYPE: Record<AccountType, AccountClass> = {
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
};

function getFiscalYearStartDate(asOf: string, fiscalStartMonth: number): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const fiscalYear = month >= fiscalStartMonth ? year : year - 1;
  return `${fiscalYear}-${String(fiscalStartMonth).padStart(2, '0')}-01`;
}

function getPreviousYearStartDate(asOf: string): string {
  const year = Number(asOf.slice(0, 4));
  return `${year - 1}-01-01`;
}

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getSyntheticEquityLabel(type: 'Prior' | 'Current', fundName: string): string {
  const period = type === 'Prior' ? 'Prior Years' : 'Current Year';
  return `[System] Net Income (${period}) - ${fundName}`;
}

function resolveAccountClass(accountType: AccountType, accountClass: AccountClass | null): AccountClass {
  return accountClass || DEFAULT_ACCOUNT_CLASS_BY_TYPE[accountType];
}

function baseQuery({ from, to, asOf, fundId }: BaseQueryArgs = {}): Knex.QueryBuilder {
  const query = db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .join('funds as f', 'f.id', 'je.fund_id')
    .where('t.is_voided', false);

  if (from) query.where('t.date', '>=', from);
  if (to) query.where('t.date', '<=', to);
  if (asOf) query.where('t.date', '<=', asOf);
  if (fundId) query.where('je.fund_id', fundId);

  return query;
}

async function getPL({ from, to, fundId }: DateRangeArgs): Promise<PLReportData> {
  const rows = await baseQuery({ from, to, fundId })
    .whereIn('a.type', ['INCOME', 'EXPENSE'])
    .where('t.is_closing_entry', false)
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
  const balanceAsOf = asOf || normalizeDateOnly(new Date());
  const lastClosedPeriod = await db('fiscal_periods')
    .where('period_end', '<=', balanceAsOf)
    .orderBy('period_end', 'desc')
    .select('period_end', 'fiscal_year')
    .first() as { period_end: string | Date; fiscal_year: number } | undefined;
  const last_hard_close_date = lastClosedPeriod ? normalizeDateOnly(lastClosedPeriod.period_end) : null;

  const rows = await baseQuery({ asOf: balanceAsOf, fundId })
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
  const diagnostics: ReportDiagnostic[] = [];

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

  const fiscalYearStartMonthRow = await db('settings')
    .where({ key: 'fiscal_year_start' })
    .select('value')
    .first() as { value?: string | null } | undefined;
  const fiscalStartMonth = Math.max(1, Math.min(12, parseInt(fiscalYearStartMonthRow?.value ?? '1', 10) || 1));
  const fiscalYearStart = getFiscalYearStartDate(balanceAsOf, fiscalStartMonth);

  const priorRows = await db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('t.is_voided', false)
    .where('t.date', '<', fiscalYearStart)
    .whereIn('a.type', ['INCOME', 'EXPENSE'])
    .modify((query) => {
      if (fundId) query.where('je.fund_id', fundId);
      if (last_hard_close_date) query.where('t.date', '>', last_hard_close_date);
    })
    .select(
      'je.fund_id',
      db.raw('COALESCE(SUM(je.debit), 0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('je.fund_id') as TrialBalancePriorNetRow[];

  const currentRows = await db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('t.is_voided', false)
    .where('t.date', '>=', fiscalYearStart)
    .where('t.date', '<=', balanceAsOf)
    .whereIn('a.type', ['INCOME', 'EXPENSE'])
    .modify((query) => {
      if (fundId) query.where('je.fund_id', fundId);
      if (last_hard_close_date && last_hard_close_date >= fiscalYearStart) {
        query.where('t.date', '>', last_hard_close_date);
      }
    })
    .select(
      'je.fund_id',
      db.raw('COALESCE(SUM(je.debit), 0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('je.fund_id') as TrialBalancePriorNetRow[];

  const allFundIds = [...new Set([...priorRows.map((row) => row.fund_id), ...currentRows.map((row) => row.fund_id)])];
  const fundsById = new Map<number, TrialBalanceFundRow>();
  if (allFundIds.length > 0) {
    const fundRows = await db('funds as f')
      .leftJoin('accounts as a', 'a.id', 'f.net_asset_account_id')
      .whereIn('f.id', allFundIds)
      .select(
        'f.id',
        'f.name',
        'f.net_asset_account_id',
        'a.code as net_asset_code',
        'a.name as net_asset_name'
      ) as TrialBalanceFundRow[];
    for (const fund of fundRows) fundsById.set(fund.id, fund);
  }

  const unmappedFunds = new Set<number>();

  for (const row of priorRows) {
    const priorNetIncome = dec(row.total_credit).minus(dec(row.total_debit));
    if (priorNetIncome.isZero()) continue;

    const fund = fundsById.get(row.fund_id);
    const hasMappedNetAsset = Boolean(fund?.net_asset_account_id);
    const syntheticCode = hasMappedNetAsset ? String(fund?.net_asset_code || '3000') : UNALLOCATED_SYNTHETIC_EQUITY_CODE;
    const syntheticFundName = String(fund?.name || `Fund #${row.fund_id}`);
    const syntheticBalance = parseFloat(priorNetIncome.toFixed(2));

    if (!hasMappedNetAsset && !unmappedFunds.has(row.fund_id)) {
      unmappedFunds.add(row.fund_id);
      diagnostics.push({
        code: 'UNMAPPED_FUND_NET_ASSET',
        severity: 'warning',
        message: `${syntheticFundName} has no net-asset account mapping. Synthetic equity routed to ${UNALLOCATED_SYNTHETIC_EQUITY_CODE} (${UNALLOCATED_SYNTHETIC_EQUITY_NAME}).`,
        account_id: null,
        fund_id: row.fund_id,
        investigate_filters: null,
      });
    }

    equity.push({
      id: -2000000 - row.fund_id,
      code: syntheticCode,
      name: getSyntheticEquityLabel('Prior', syntheticFundName),
      balance: syntheticBalance,
      is_synthetic: true,
      synthetic_note: `Synthetic prior-years close for ${syntheticFundName}`,
      investigate_filters: {
        from: '1900-01-01',
        to: dayBefore(fiscalYearStart),
        fund_id: row.fund_id,
        account_id: null,
      },
    });
    totalEquity = totalEquity.plus(priorNetIncome);
    diagnostics.push({
      code: 'SUGGEST_HARD_CLOSE',
      severity: 'info',
      message: `${syntheticFundName} has a prior-years synthetic balance (${priorNetIncome.toFixed(2)}). Consider posting a hard close journal entry.`,
      account_id: null,
      fund_id: row.fund_id,
      investigate_filters: {
        from: '1900-01-01',
        to: dayBefore(fiscalYearStart),
        fund_id: row.fund_id,
        account_id: null,
      },
    });
  }

  for (const row of currentRows) {
    const currentNetIncome = dec(row.total_credit).minus(dec(row.total_debit));
    if (currentNetIncome.isZero()) continue;

    const fund = fundsById.get(row.fund_id);
    const hasMappedNetAsset = Boolean(fund?.net_asset_account_id);
    const syntheticCode = hasMappedNetAsset ? String(fund?.net_asset_code || '3000') : UNALLOCATED_SYNTHETIC_EQUITY_CODE;
    const syntheticFundName = String(fund?.name || `Fund #${row.fund_id}`);

    if (!hasMappedNetAsset && !unmappedFunds.has(row.fund_id)) {
      unmappedFunds.add(row.fund_id);
      diagnostics.push({
        code: 'UNMAPPED_FUND_NET_ASSET',
        severity: 'warning',
        message: `${syntheticFundName} has no net-asset account mapping. Synthetic equity routed to ${UNALLOCATED_SYNTHETIC_EQUITY_CODE} (${UNALLOCATED_SYNTHETIC_EQUITY_NAME}).`,
        account_id: null,
        fund_id: row.fund_id,
        investigate_filters: null,
      });
    }

    equity.push({
      id: -3000000 - row.fund_id,
      code: syntheticCode,
      name: getSyntheticEquityLabel('Current', syntheticFundName),
      balance: parseFloat(currentNetIncome.toFixed(2)),
      is_synthetic: true,
      synthetic_note: `Synthetic current-year net income for ${syntheticFundName}`,
      investigate_filters: {
        from: fiscalYearStart,
        to: balanceAsOf,
        fund_id: row.fund_id,
        account_id: null,
      },
    });
    totalEquity = totalEquity.plus(currentNetIncome);
  }

  const totalLiabilitiesAndEquity = totalLiabilities.plus(totalEquity);
  const isBalanced = totalAssets.equals(totalLiabilitiesAndEquity);

  diagnostics.push({
    code: isBalanced ? 'BALANCED' : 'UNBALANCED',
    severity: isBalanced ? 'info' : 'warning',
    message: isBalanced
      ? 'Balance Sheet is balanced.'
      : `Balance Sheet is out of balance by ${totalAssets.minus(totalLiabilitiesAndEquity).toFixed(2)}.`,
    account_id: null,
    fund_id: fundId ? Number(fundId) : null,
    investigate_filters: null,
  });

  const dedupedDiagnostics = diagnostics.filter((diagnostic, index, all) => {
    const key = `${diagnostic.code}:${diagnostic.fund_id ?? 'null'}`;
    return index === all.findIndex((candidate) => `${candidate.code}:${candidate.fund_id ?? 'null'}` === key);
  });

  return {
    assets,
    liabilities,
    equity,
    total_assets: parseFloat(totalAssets.toFixed(2)),
    total_liabilities: parseFloat(totalLiabilities.toFixed(2)),
    total_equity: parseFloat(totalEquity.toFixed(2)),
    total_liabilities_and_equity: parseFloat(totalLiabilitiesAndEquity.toFixed(2)),
    is_balanced: isBalanced,
    diagnostics: dedupedDiagnostics,
    last_hard_close_date,
  };
}

async function getLedger({ from, to, fundId, accountId }: LedgerArgs): Promise<LedgerReportData> {
  const txContactRollup = db('journal_entries as je_tx')
    .join('transactions as t_tx', 't_tx.id', 'je_tx.transaction_id')
    .leftJoin('contacts as c_tx', 'c_tx.id', 'je_tx.contact_id')
    .join('accounts as a_tx', 'a_tx.id', 'je_tx.account_id')
    .where('t_tx.is_voided', false)
    .modify((query) => {
      if (from) query.where('t_tx.date', '>=', from);
      if (to) query.where('t_tx.date', '<=', to);
      if (fundId) query.where('je_tx.fund_id', fundId);
    })
    .select(
      'je_tx.transaction_id',
      db.raw('COUNT(DISTINCT je_tx.contact_id) AS contact_count'),
      db.raw('MAX(c_tx.name) AS contact_name'),
      db.raw(`COALESCE(SUM(CASE WHEN je_tx.contact_id IS NULL AND a_tx.type <> 'ASSET' THEN 1 ELSE 0 END), 0) AS missing_contact_non_asset_count`)
    )
    .groupBy('je_tx.transaction_id')
    .as('tx_contacts');

  const accountQuery = db('accounts as a')
    .where('a.is_active', true)
    .orderBy('a.code', 'asc');

  if (accountId) {
    accountQuery.where('a.id', accountId);
  }

  const accounts = await accountQuery.select('a.id', 'a.code', 'a.name', 'a.type') as AccountRow[];
  const fiscalYearStartMonthRow = await db('settings')
    .where({ key: 'fiscal_year_start' })
    .select('value')
    .first() as { value?: string | null } | undefined;
  const fiscalStartMonth = Math.max(1, Math.min(12, parseInt(fiscalYearStartMonthRow?.value ?? '1', 10) || 1));
  let fiscalYearStartForFrom: string | null = null;
  if (from) {
    const fromYear = Number(from.slice(0, 4));
    const fromMonth = Number(from.slice(5, 7));
    const fiscalYearStartYear = fromMonth >= fiscalStartMonth ? fromYear : fromYear - 1;
    fiscalYearStartForFrom = `${fiscalYearStartYear}-${String(fiscalStartMonth).padStart(2, '0')}-01`;
  }
  const ledger: LedgerReportData['ledger'] = [];

  for (const account of accounts) {
    const entries = await baseQuery({ from, to, fundId })
      .leftJoin('contacts as c', 'c.id', 'je.contact_id')
      .leftJoin(txContactRollup, 'tx_contacts.transaction_id', 'je.transaction_id')
      .where('je.account_id', account.id)
      .select(
        't.date',
        't.description',
        't.reference_no',
        db.raw(`CASE
          WHEN c.name IS NOT NULL THEN c.name
          WHEN a.type = 'ASSET'
            AND COALESCE(tx_contacts.contact_count, 0) = 1
            AND COALESCE(tx_contacts.missing_contact_non_asset_count, 0) = 0
          THEN tx_contacts.contact_name
          ELSE NULL
        END AS contact_name`),
        'f.name as fund_name',
        'je.debit',
        'je.credit',
        'je.memo'
      )
      .orderBy('t.date', 'asc')
      .orderBy('je.id', 'asc') as LedgerEntryRow[];

    if (entries.length === 0 && !from && !accountId) continue;

    let openingBalance = dec(0);
    if (from) {
      const isIncomeOrExpense = account.type === 'INCOME' || account.type === 'EXPENSE';
      const prior = await db('journal_entries as je')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .where('je.account_id', account.id)
        .where('t.is_voided', false)
        .where('t.date', '<', from)
        .modify((query) => {
          if (fundId) query.where('je.fund_id', fundId);
          if (isIncomeOrExpense && fiscalYearStartForFrom) query.where('t.date', '>=', fiscalYearStartForFrom);
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

    if (entries.length === 0 && openingBalance.isZero() && !accountId) continue;

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
        contact_name: entry.contact_name,
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

async function getTrialBalance({ asOf, fundId }: TrialBalanceArgs): Promise<TrialBalanceReportData> {
  const trialAsOf = asOf || normalizeDateOnly(new Date());
  const lastClosedPeriod = await db('fiscal_periods')
    .where('period_end', '<=', trialAsOf)
    .orderBy('period_end', 'desc')
    .select('period_end', 'fiscal_year')
    .first() as { period_end: string | Date; fiscal_year: number } | undefined;
  const last_hard_close_date = lastClosedPeriod ? normalizeDateOnly(lastClosedPeriod.period_end) : null;

  const fiscalYearStartMonthRow = await db('settings')
    .where({ key: 'fiscal_year_start' })
    .select('value')
    .first() as { value?: string | null } | undefined;
  const fiscalStartMonth = Math.max(1, Math.min(12, parseInt(fiscalYearStartMonthRow?.value ?? '1', 10) || 1));
  const fiscalYearStart = getFiscalYearStartDate(trialAsOf, fiscalStartMonth);
  const previousYearStart = getPreviousYearStartDate(trialAsOf);

  const accountsRows = await db('accounts as a')
    .where('a.is_active', true)
    .select('a.id', 'a.code', 'a.name', 'a.type', 'a.account_class', 'a.normal_balance')
    .orderBy('a.code', 'asc') as TrialBalanceRow[];

  const balanceSheetRows = await db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('t.is_voided', false)
    .where('t.date', '<=', trialAsOf)
    .whereIn('a.type', ['ASSET', 'LIABILITY', 'EQUITY'])
    .modify((query) => {
      if (fundId) query.where('je.fund_id', fundId);
    })
    .select(
      'je.account_id',
      db.raw('COALESCE(SUM(je.debit), 0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('je.account_id') as TrialBalanceAggregateRow[];

  const incomeExpenseRows = await db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('t.is_voided', false)
    .where('t.date', '>=', fiscalYearStart)
    .where('t.date', '<=', trialAsOf)
    .whereIn('a.type', ['INCOME', 'EXPENSE'])
    .modify((query) => {
      if (fundId) query.where('je.fund_id', fundId);
      if (last_hard_close_date && last_hard_close_date >= fiscalYearStart) {
        query.where('t.date', '>', last_hard_close_date);
      }
    })
    .select(
      'je.account_id',
      db.raw('COALESCE(SUM(je.debit), 0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('je.account_id') as TrialBalanceAggregateRow[];

  const totalsByAccount = new Map<number, { debit: Decimal; credit: Decimal }>();
  for (const row of [...balanceSheetRows, ...incomeExpenseRows]) {
    const current = totalsByAccount.get(row.account_id) || { debit: ZERO, credit: ZERO };
    current.debit = current.debit.plus(dec(row.total_debit));
    current.credit = current.credit.plus(dec(row.total_credit));
    totalsByAccount.set(row.account_id, current);
  }

  const diagnostics: ReportDiagnostic[] = [];
  const trialBalanceAccounts: TrialBalanceReportData['accounts'] = accountsRows.map((account) => {
    const totals = totalsByAccount.get(account.id) || { debit: ZERO, credit: ZERO };
    const totalDebit = totals.debit;
    const totalCredit = totals.credit;
    const net = totalDebit.minus(totalCredit);
    const netDebit = net.greaterThan(0) ? net : ZERO;
    const netCredit = net.lessThan(0) ? net.abs() : ZERO;
    const netSide: NormalBalanceSide | null = net.isZero() ? null : net.greaterThan(0) ? 'DEBIT' : 'CREDIT';

    const accountClass = resolveAccountClass(account.type, account.account_class);
    const normalBalance = account.normal_balance || DEFAULT_NORMAL_BALANCE_BY_CLASS[accountClass];
    const isAbnormalBalance = !net.isZero() && netSide !== normalBalance;
    const investigateFrom = account.type === 'INCOME' || account.type === 'EXPENSE'
      ? fiscalYearStart
      : previousYearStart;

    if (isAbnormalBalance) {
      diagnostics.push({
        code: 'ABNORMAL_BALANCE',
        severity: 'warning',
        message: `${account.code} — ${account.name} is ${netSide} but normal balance is ${normalBalance}.`,
        account_id: account.id,
        fund_id: fundId ? Number(fundId) : null,
        investigate_filters: {
          from: investigateFrom,
          to: trialAsOf,
          fund_id: fundId ? Number(fundId) : null,
          account_id: account.id,
        },
      });
    }

    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      account_class: accountClass,
      normal_balance: normalBalance,
      net_side: netSide,
      net_debit: parseFloat(netDebit.toFixed(2)),
      net_credit: parseFloat(netCredit.toFixed(2)),
      total_debit: parseFloat(totalDebit.toFixed(2)),
      total_credit: parseFloat(totalCredit.toFixed(2)),
      is_abnormal_balance: isAbnormalBalance,
      is_synthetic: false,
      synthetic_note: null,
      investigate_filters: {
        from: investigateFrom,
        to: trialAsOf,
        fund_id: fundId ? Number(fundId) : null,
        account_id: account.id,
      },
    };
  });

  const priorYearsNetRows = await db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('t.is_voided', false)
    .where('t.date', '<', fiscalYearStart)
    .whereIn('a.type', ['INCOME', 'EXPENSE'])
    .modify((query) => {
      if (fundId) query.where('je.fund_id', fundId);
      if (last_hard_close_date) query.where('t.date', '>', last_hard_close_date);
    })
    .select(
      'je.fund_id',
      db.raw('COALESCE(SUM(je.debit), 0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('je.fund_id') as TrialBalancePriorNetRow[];

  const fundIds = priorYearsNetRows.map((row) => row.fund_id);
  const fundsById = new Map<number, TrialBalanceFundRow>();
  if (fundIds.length > 0) {
    const fundRows = await db('funds as f')
      .leftJoin('accounts as a', 'a.id', 'f.net_asset_account_id')
      .whereIn('f.id', fundIds)
      .select(
        'f.id',
        'f.name',
        'f.net_asset_account_id',
        'a.code as net_asset_code',
        'a.name as net_asset_name'
      ) as TrialBalanceFundRow[];
    for (const fund of fundRows) fundsById.set(fund.id, fund);
  }

  for (const row of priorYearsNetRows) {
    const priorNetIncome = dec(row.total_credit).minus(dec(row.total_debit));
    if (priorNetIncome.isZero()) continue;

    const fund = fundsById.get(row.fund_id);
    const hasMappedNetAsset = Boolean(fund?.net_asset_account_id);
    const syntheticCode = hasMappedNetAsset
      ? String(fund?.net_asset_code || '3000')
      : UNALLOCATED_SYNTHETIC_EQUITY_CODE;
    const syntheticFundName = String(fund?.name || `Fund #${row.fund_id}`);
    const syntheticNote = `Synthetic prior-years close for ${syntheticFundName}`;

    if (!hasMappedNetAsset) {
      diagnostics.push({
        code: 'UNMAPPED_FUND_NET_ASSET',
        severity: 'warning',
        message: `${fund?.name || `Fund #${row.fund_id}`} has no net-asset account mapping. Prior-years close routed to ${UNALLOCATED_SYNTHETIC_EQUITY_CODE} (${UNALLOCATED_SYNTHETIC_EQUITY_NAME}).`,
        account_id: null,
        fund_id: row.fund_id,
        investigate_filters: null,
      });
    }

    const syntheticNetDebit = priorNetIncome.lessThan(0) ? priorNetIncome.abs() : ZERO;
    const syntheticNetCredit = priorNetIncome.greaterThan(0) ? priorNetIncome : ZERO;
    const investigateFilters = {
      from: '1900-01-01',
      to: dayBefore(fiscalYearStart),
      fund_id: row.fund_id,
      account_id: null,
    };

    trialBalanceAccounts.push({
      id: -1000000 - row.fund_id,
      code: syntheticCode,
      name: getSyntheticEquityLabel('Prior', syntheticFundName),
      type: 'EQUITY',
      account_class: 'EQUITY',
      normal_balance: 'CREDIT',
      net_side: priorNetIncome.isZero() ? null : priorNetIncome.greaterThan(0) ? 'CREDIT' : 'DEBIT',
      net_debit: parseFloat(syntheticNetDebit.toFixed(2)),
      net_credit: parseFloat(syntheticNetCredit.toFixed(2)),
      total_debit: parseFloat(syntheticNetDebit.toFixed(2)),
      total_credit: parseFloat(syntheticNetCredit.toFixed(2)),
      is_abnormal_balance: false,
      is_synthetic: true,
      synthetic_note: syntheticNote,
      investigate_filters: investigateFilters,
    });

    diagnostics.push({
      code: 'SUGGEST_HARD_CLOSE',
      severity: 'info',
      message: `${syntheticFundName} has a prior-years synthetic balance (${priorNetIncome.toFixed(2)}). Consider posting a hard close journal entry.`,
      account_id: null,
      fund_id: row.fund_id,
      investigate_filters: investigateFilters,
    });
  }

  const hasEquityAccount = trialBalanceAccounts.some((account) => account.type === 'EQUITY' && !account.is_synthetic);
  if (!hasEquityAccount) {
    diagnostics.push({
      code: 'MISSING_EQUITY_ACCOUNTS',
      severity: 'warning',
      message: 'No active equity accounts were found. Verify fund net-asset account setup.',
      account_id: null,
      fund_id: fundId ? Number(fundId) : null,
      investigate_filters: null,
    });
  }

  const visibleTrialBalanceAccounts = trialBalanceAccounts.filter((account) => {
    if (account.is_synthetic && account.net_debit === 0 && account.net_credit === 0) return false;
    if (account.type !== 'INCOME' && account.type !== 'EXPENSE') return true;
    return !(account.net_debit === 0 && account.net_credit === 0);
  });

  visibleTrialBalanceAccounts.sort((a, b) => {
    const byType = TRIAL_BALANCE_TYPE_ORDER[a.type] - TRIAL_BALANCE_TYPE_ORDER[b.type];
    if (byType !== 0) return byType;

    const byCode = a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
    if (byCode !== 0) return byCode;

    if (a.is_synthetic !== b.is_synthetic) return a.is_synthetic ? 1 : -1;

    return a.name.localeCompare(b.name);
  });

  const grandDebit = visibleTrialBalanceAccounts.reduce((sum, account) => sum.plus(dec(account.net_debit)), ZERO);
  const grandCredit = visibleTrialBalanceAccounts.reduce((sum, account) => sum.plus(dec(account.net_credit)), ZERO);
  const roundedDebit = grandDebit.toDecimalPlaces(2);
  const roundedCredit = grandCredit.toDecimalPlaces(2);
  const isBalanced = roundedDebit.equals(roundedCredit);

  diagnostics.push({
    code: isBalanced ? 'BALANCED' : 'UNBALANCED',
    severity: isBalanced ? 'info' : 'warning',
    message: isBalanced
      ? 'Trial Balance is balanced.'
      : `Trial Balance is out of balance by ${roundedDebit.minus(roundedCredit).toFixed(2)}.`,
    account_id: null,
    fund_id: fundId ? Number(fundId) : null,
    investigate_filters: null,
  });

  return {
    accounts: visibleTrialBalanceAccounts,
    grand_total_debit: parseFloat(roundedDebit.toFixed(2)),
    grand_total_credit: parseFloat(roundedCredit.toFixed(2)),
    is_balanced: isBalanced,
    as_of: trialAsOf,
    fiscal_year_start: fiscalYearStart,
    diagnostics,
    last_hard_close_date,
  };
}

async function getDonorSummary({ from, to, fundId, accountIds }: DateRangeArgs): Promise<DonorSummaryReportData> {
  const rows = await db('transactions as t')
    .join('journal_entries as je', 'je.transaction_id', 't.id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .join('contacts as c', 'c.id', 'je.contact_id')
    .where('t.is_voided', false)
    .where('a.type', 'INCOME')
    .where('je.credit', '>', 0)
    .whereNotNull('je.contact_id')
    .modify((query) => {
      if (from) query.where('t.date', '>=', from);
      if (to) query.where('t.date', '<=', to);
      if (fundId) query.where('je.fund_id', fundId);
      if (accountIds?.length) query.whereIn('a.id', accountIds);
    })
    .select(
      'c.id as contact_id',
      'c.name as contact_name',
      'c.contact_class as contact_class',
      db.raw('COALESCE(SUM(je.credit), 0) AS total'),
      db.raw('COUNT(DISTINCT t.id) AS transaction_count')
    )
    .groupBy('c.id', 'c.name', 'c.contact_class')
    .orderBy('contact_name', 'asc') as DonorSummaryRow[];

  const anonRow = await db('transactions as t')
    .join('journal_entries as je', 'je.transaction_id', 't.id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('t.is_voided', false)
    .where('a.type', 'INCOME')
    .where('je.credit', '>', 0)
    .whereNull('je.contact_id')
    .modify((query) => {
      if (from) query.where('t.date', '>=', from);
      if (to) query.where('t.date', '<=', to);
      if (fundId) query.where('je.fund_id', fundId);
      if (accountIds?.length) query.whereIn('a.id', accountIds);
    })
    .select(
      db.raw('COALESCE(SUM(je.credit), 0) AS total'),
      db.raw('COUNT(DISTINCT t.id) AS transaction_count')
    )
    .first() as DonorSummaryAnonRow | undefined;

  const donors = rows.map((row) => ({
    contact_id: row.contact_id,
    contact_name: row.contact_name,
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

async function getDonorDetail({ from, to, fundId, contactId, accountIds }: DonorDetailArgs): Promise<DonorDetailReportData> {
  if (contactId) {
    const contact = await db('contacts').where({ id: contactId }).first() as ContactRow | undefined;
    if (!contact) return { donors: [], anonymous: null, grand_total: 0 };

    const transactions = await getDonationLines({ from, to, fundId, accountIds, contactId });
    const total = transactions.reduce((sum, tx) => sum.plus(dec(tx.amount)), dec(0));

    return {
      donors: [
        {
          contact_id: contact.id,
          contact_name: contact.name,
          contact_class: contact.contact_class,
          total: parseFloat(total.toFixed(2)),
          transactions,
        },
      ],
      anonymous: null,
      grand_total: parseFloat(total.toFixed(2)),
    };
  }

  const transactions = await getDonationLines({ from, to, fundId, accountIds });
  const contactIds = [...new Set(transactions
    .map((tx) => tx.contact_id)
    .filter((id): id is number => id !== null))];
  const contacts = contactIds.length > 0
    ? await db('contacts').whereIn('id', contactIds) as ContactRow[]
    : [];
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const transactionsByContactId = new Map<number, typeof transactions>();

  for (const tx of transactions) {
    if (tx.contact_id === null) continue;
    const contactTransactions = transactionsByContactId.get(tx.contact_id) || [];
    contactTransactions.push(tx);
    transactionsByContactId.set(tx.contact_id, contactTransactions);
  }

  const donors: DonorDetailReportData['donors'] = [];
  let grandTotal = dec(0);

  for (const id of contactIds) {
    const contact = contactsById.get(id);
    if (!contact) continue;

    const contactTransactions = transactionsByContactId.get(id) || [];
    const total = contactTransactions.reduce((sum, tx) => sum.plus(dec(tx.amount)), dec(0));
    grandTotal = grandTotal.plus(total);

    donors.push({
      contact_id: contact.id,
      contact_name: contact.name,
      contact_class: contact.contact_class,
      total: parseFloat(total.toFixed(2)),
      transactions: contactTransactions,
    });
  }

  donors.sort((a, b) => a.contact_name.localeCompare(b.contact_name));

  const anonTransactions = transactions.filter((tx) => tx.contact_id === null);
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
