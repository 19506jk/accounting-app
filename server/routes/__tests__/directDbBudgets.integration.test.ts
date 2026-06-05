import dotenv from 'dotenv';
import type { Router } from 'express';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { requestMountedRoute } from '../routeTestHelpers.js';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdBudgetAccountIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
let originalFiscalYearStartValue: string | null = null;

let budgetsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');
  const mod = await import('../budgets.js');
  budgetsRouter = mod.default as unknown as Router;
});

afterEach(async () => {
  if (originalFiscalYearStartValue !== null) {
    await db('settings')
      .where({ key: 'fiscal_year_start' })
      .update({ value: originalFiscalYearStartValue, updated_at: db.fn.now() });
    originalFiscalYearStartValue = null;
  }
  // Delete budget rows before accounts (FK RESTRICT on account_id)
  if (createdBudgetAccountIds.length > 0) {
    await db('account_budgets').whereIn('account_id', createdBudgetAccountIds).delete();
    createdBudgetAccountIds.length = 0;
  }
  // Deleting transactions cascades to journal_entries
  if (createdTransactionIds.length > 0) {
    await db('transactions').whereIn('id', createdTransactionIds).delete();
    createdTransactionIds.length = 0;
  }
  if (createdFundIds.length > 0) {
    await db('funds').whereIn('id', createdFundIds).delete();
    createdFundIds.length = 0;
  }
  if (createdAccountIds.length > 0) {
    await db('accounts').whereIn('id', createdAccountIds).delete();
    createdAccountIds.length = 0;
  }
});

async function requestRoute({
  probePath,
  method = 'GET',
  role = 'admin',
  body,
}: {
  probePath: string;
  method?: 'GET' | 'PUT';
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/budgets',
    probePath,
    method,
    router: budgetsRouter,
    role,
    body,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function createTestAccounts(suffix: string) {
  const [income] = await db('accounts')
    .insert({
      code: `BGTI-${suffix}`,
      name: `Budget Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;

  const [expense] = await db('accounts')
    .insert({
      code: `BGTE-${suffix}`,
      name: `Budget Expense ${suffix}`,
      type: 'EXPENSE',
      account_class: 'EXPENSE',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;

  const [bank] = await db('accounts')
    .insert({
      code: `BGTB-${suffix}`,
      name: `Budget Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;

  createdAccountIds.push(income!.id, expense!.id, bank!.id);
  return { income: income!, expense: expense!, bank: bank! };
}

async function createFund(suffix: string) {
  const [fund] = await db('funds')
    .insert({
      name: `Budget Fund ${suffix}`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  createdFundIds.push(fund!.id);
  return fund!;
}

async function createTransaction({
  date,
  fundId,
  isClosingEntry = false,
}: {
  date: string;
  fundId: number;
  isClosingEntry?: boolean;
}) {
  const suffix = uniqueSuffix();
  const [txn] = await db('transactions')
    .insert({
      date,
      description: `Budget Test Txn ${suffix}`,
      fund_id: fundId,
      is_closing_entry: isClosingEntry,
      created_by: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  createdTransactionIds.push(txn!.id);
  return txn!;
}

async function addJournalEntries(
  transactionId: number,
  fundId: number,
  entries: Array<{ account_id: number; debit: string; credit: string }>,
) {
  await db('journal_entries').insert(
    entries.map((e) => ({
      transaction_id: transactionId,
      account_id: e.account_id,
      fund_id: fundId,
      debit: e.debit,
      credit: e.credit,
      is_reconciled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })),
  );
}

// ── Access control ────────────────────────────────────────────────────────────

describe('access control', () => {
  it('returns 403 for editor on GET', async () => {
    const res = await requestRoute({ probePath: '/?fiscal_year=2020', role: 'editor' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for viewer on GET', async () => {
    const res = await requestRoute({ probePath: '/?fiscal_year=2020', role: 'viewer' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for editor on PUT', async () => {
    const res = await requestRoute({
      probePath: '/999',
      method: 'PUT',
      role: 'editor',
      body: { fiscal_year: 2020, amount: 500 },
    });
    expect(res.status).toBe(403);
  });
});

// ── GET happy path ────────────────────────────────────────────────────────────

describe('GET /api/budgets', () => {
  it('returns 400 when fiscal_year is missing', async () => {
    const res = await requestRoute({ probePath: '/' });
    expect(res.status).toBe(400);
  });

  it('returns income and expense accounts with zero budgets when none set', async () => {
    const suffix = uniqueSuffix();
    const { income, expense } = await createTestAccounts(suffix);

    const res = await requestRoute({ probePath: '/?fiscal_year=2010' });
    expect(res.status).toBe(200);

    const rows: Array<Record<string, unknown>> = res.body.rows;
    const incomeRow = rows.find((r) => r.account_id === income.id);
    const expenseRow = rows.find((r) => r.account_id === expense.id);

    expect(incomeRow).toBeDefined();
    expect(expenseRow).toBeDefined();
    expect(incomeRow!.budget_amount).toBe(0);
    expect(incomeRow!.prior_budget_amount).toBe(0);
    expect(incomeRow!.prior_actual_amount).toBe(0);
  });

  it('returns monetary fields as numbers, not strings', async () => {
    const suffix = uniqueSuffix();
    const { income } = await createTestAccounts(suffix);
    createdBudgetAccountIds.push(income.id);

    await db('account_budgets').insert({
      account_id: income.id,
      fiscal_year: 2010,
      amount: '1234.56',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const res = await requestRoute({ probePath: '/?fiscal_year=2010' });
    expect(res.status).toBe(200);

    const row = res.body.rows.find((r: Record<string, unknown>) => r.account_id === income.id);
    expect(typeof row.budget_amount).toBe('number');
    expect(typeof row.actual_amount).toBe('number');
    expect(typeof row.prior_budget_amount).toBe('number');
    expect(typeof row.prior_actual_amount).toBe('number');
    expect(row.budget_amount).toBe(1234.56);
  });

  it('aggregates prior-year actuals correctly (January fiscal year)', async () => {
    const suffix = uniqueSuffix();
    const { income, bank } = await createTestAccounts(suffix);
    const fund = await createFund(suffix);

    // Prior year for fiscal_year=2015 (January start) = 2014-01-01 to 2014-12-31
    const txn = await createTransaction({ date: '2014-06-15', fundId: fund.id });
    await addJournalEntries(txn.id, fund.id, [
      { account_id: bank.id, debit: '200.00', credit: '0.00' },
      { account_id: income.id, debit: '0.00', credit: '200.00' },
    ]);

    const res = await requestRoute({ probePath: '/?fiscal_year=2015' });
    expect(res.status).toBe(200);

    const row = res.body.rows.find((r: Record<string, unknown>) => r.account_id === income.id);
    expect(row.prior_actual_amount).toBe(200);
  });

  it('aggregates selected-year actuals into actual_amount (January fiscal year)', async () => {
    const suffix = uniqueSuffix();
    const { income, bank } = await createTestAccounts(suffix);
    const fund = await createFund(suffix);

    // Selected fiscal_year=2015 (January start) = 2015-01-01 to 2015-12-31
    const txn = await createTransaction({ date: '2015-08-20', fundId: fund.id });
    await addJournalEntries(txn.id, fund.id, [
      { account_id: bank.id, debit: '350.00', credit: '0.00' },
      { account_id: income.id, debit: '0.00', credit: '350.00' },
    ]);

    const res = await requestRoute({ probePath: '/?fiscal_year=2015' });
    expect(res.status).toBe(200);

    const row = res.body.rows.find((r: Record<string, unknown>) => r.account_id === income.id);
    expect(row.actual_amount).toBe(350);
    // Same transaction is in the selected year, not the prior year.
    expect(row.prior_actual_amount).toBe(0);
  });

  it('excludes closing entries from prior-year actuals', async () => {
    const suffix = uniqueSuffix();
    const { income, bank } = await createTestAccounts(suffix);
    const fund = await createFund(suffix);

    // Regular transaction in prior year
    const txn = await createTransaction({ date: '2014-06-15', fundId: fund.id });
    await addJournalEntries(txn.id, fund.id, [
      { account_id: bank.id, debit: '300.00', credit: '0.00' },
      { account_id: income.id, debit: '0.00', credit: '300.00' },
    ]);

    // Closing entry in same prior year — must NOT be included in actuals
    const closingTxn = await createTransaction({ date: '2014-12-31', fundId: fund.id, isClosingEntry: true });
    await addJournalEntries(closingTxn.id, fund.id, [
      { account_id: income.id, debit: '300.00', credit: '0.00' },
      { account_id: bank.id, debit: '0.00', credit: '300.00' },
    ]);

    const res = await requestRoute({ probePath: '/?fiscal_year=2015' });
    expect(res.status).toBe(200);

    const row = res.body.rows.find((r: Record<string, unknown>) => r.account_id === income.id);
    // Only the regular transaction should count; closing entry excluded
    expect(row.prior_actual_amount).toBe(300);
  });

  it('uses settings-driven date range for non-January fiscal year', async () => {
    const suffix = uniqueSuffix();

    // Save and override fiscal_year_start to July (7)
    const currentSetting = await db('settings').where({ key: 'fiscal_year_start' }).first() as { value: string | null } | undefined;
    originalFiscalYearStartValue = currentSetting?.value ?? '1';
    await db('settings').where({ key: 'fiscal_year_start' }).update({ value: '7', updated_at: db.fn.now() });

    const { expense, bank } = await createTestAccounts(suffix);
    const fund = await createFund(suffix);

    // FY2016 with July start = July 2015 to June 2016
    // Prior year for GET fiscal_year=2016 is FY2015 = July 2014 to June 2015

    // In range: March 2015
    const inRangeTxn = await createTransaction({ date: '2015-03-10', fundId: fund.id });
    await addJournalEntries(inRangeTxn.id, fund.id, [
      { account_id: expense.id, debit: '75.00', credit: '0.00' },
      { account_id: bank.id, debit: '0.00', credit: '75.00' },
    ]);

    // Out of range: September 2015 (inside FY2016, not FY2015)
    const outOfRangeTxn = await createTransaction({ date: '2015-09-01', fundId: fund.id });
    await addJournalEntries(outOfRangeTxn.id, fund.id, [
      { account_id: expense.id, debit: '500.00', credit: '0.00' },
      { account_id: bank.id, debit: '0.00', credit: '500.00' },
    ]);

    const res = await requestRoute({ probePath: '/?fiscal_year=2016' });
    expect(res.status).toBe(200);

    const row = res.body.rows.find((r: Record<string, unknown>) => r.account_id === expense.id);
    // Only the in-range transaction should appear
    expect(row.prior_actual_amount).toBe(75);
  });
});

// ── PUT upsert ────────────────────────────────────────────────────────────────

describe('PUT /api/budgets/:accountId', () => {
  it('creates a budget entry', async () => {
    const suffix = uniqueSuffix();
    const { income } = await createTestAccounts(suffix);
    createdBudgetAccountIds.push(income.id);

    const res = await requestRoute({
      probePath: `/${income.id}`,
      method: 'PUT',
      body: { fiscal_year: 2010, amount: 5000 },
    });
    expect(res.status).toBe(200);

    const saved = await db('account_budgets')
      .where({ account_id: income.id, fiscal_year: 2010 })
      .first() as { amount: string | number } | undefined;
    expect(parseFloat(String(saved?.amount ?? '0'))).toBe(5000);
  });

  it('updates an existing budget entry (upsert)', async () => {
    const suffix = uniqueSuffix();
    const { expense } = await createTestAccounts(suffix);
    createdBudgetAccountIds.push(expense.id);

    await requestRoute({
      probePath: `/${expense.id}`,
      method: 'PUT',
      body: { fiscal_year: 2010, amount: 1000 },
    });
    const update = await requestRoute({
      probePath: `/${expense.id}`,
      method: 'PUT',
      body: { fiscal_year: 2010, amount: 2500.50 },
    });
    expect(update.status).toBe(200);

    const saved = await db('account_budgets')
      .where({ account_id: expense.id, fiscal_year: 2010 })
      .first() as { amount: string | number } | undefined;
    expect(parseFloat(String(saved?.amount ?? '0'))).toBe(2500.50);
  });

  it('returns 422 when account type is not INCOME or EXPENSE', async () => {
    const suffix = uniqueSuffix();
    const { bank } = await createTestAccounts(suffix);

    const res = await requestRoute({
      probePath: `/${bank.id}`,
      method: 'PUT',
      body: { fiscal_year: 2010, amount: 500 },
    });
    expect(res.status).toBe(422);
  });

  it('returns 400 for negative amount', async () => {
    const res = await requestRoute({
      probePath: '/1',
      method: 'PUT',
      body: { fiscal_year: 2010, amount: -100 },
    });
    expect(res.status).toBe(400);
  });
});
