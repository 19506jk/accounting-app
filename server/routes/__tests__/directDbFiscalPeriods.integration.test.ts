import dotenv from 'dotenv';
import type { Router } from 'express';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { requestMountedRoute } from '../routeTestHelpers.js';


dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdReconciliationIds: number[] = [];
const createdFiscalPeriodIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
let originalFiscalYearStartValue: string | null = null;

let fiscalPeriodsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const fiscalPeriodsModule = await import('../fiscalPeriods.js');
  fiscalPeriodsRouter = fiscalPeriodsModule.default as unknown as Router;
});

afterEach(async () => {
  if (originalFiscalYearStartValue !== null) {
    await db('settings')
      .where({ key: 'fiscal_year_start' })
      .update({ value: originalFiscalYearStartValue, updated_at: db.fn.now() });
    originalFiscalYearStartValue = null;
  }

  if (createdReconciliationIds.length > 0) {
    await db('reconciliations').whereIn('id', createdReconciliationIds).delete();
    createdReconciliationIds.length = 0;
  }

  if (createdFiscalPeriodIds.length > 0) {
    await db('fiscal_periods').whereIn('id', createdFiscalPeriodIds).delete();
    createdFiscalPeriodIds.length = 0;
  }

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
  method,
  role = 'admin',
  body,
}: {
  probePath: string;
  method: 'GET' | 'POST' | 'DELETE';
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/fiscal-periods',
    probePath,
    method,
    router: fiscalPeriodsRouter,
    role,
    body,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function dayBefore(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function requireClosableInvestigation() {
  const tryInvestigate = async () => requestRoute({
    probePath: '/investigate',
    method: 'POST',
    role: 'admin',
  });

  const firstAttempt = await tryInvestigate();
  if (firstAttempt.status === 200) {
    return firstAttempt.body as {
      period_end: string;
      preflight: {
        all_asset_accounts_reconciled: boolean;
        unreconciled_accounts: Array<{
          account_id: number;
          account_code: string;
          account_name: string;
          required_through_date: string;
          latest_closed_statement_date: string | null;
        }>;
      };
    };
  }

  expect(firstAttempt.status).toBe(409);
  const originalSetting = await db('settings')
    .where({ key: 'fiscal_year_start' })
    .select('value')
    .first() as { value: string | null } | undefined;
  originalFiscalYearStartValue = originalSetting?.value ?? '1';

  for (let month = 1; month <= 12; month += 1) {
    await db('settings')
      .where({ key: 'fiscal_year_start' })
      .update({ value: String(month), updated_at: db.fn.now() });

    const attempt = await tryInvestigate();
    if (attempt.status === 200) {
      return attempt.body as {
        period_end: string;
        preflight: {
          all_asset_accounts_reconciled: boolean;
          unreconciled_accounts: Array<{
            account_id: number;
            account_code: string;
            account_name: string;
            required_through_date: string;
            latest_closed_statement_date: string | null;
          }>;
        };
      };
    }

    expect(attempt.status).toBe(409);
  }

  throw new Error('Unable to produce a closable window for fiscal-periods investigate test fixture');
}

async function requireClosableInvestigationForPeriod(periodEnd: string) {
  const response = await requestRoute({
    probePath: '/investigate',
    method: 'POST',
    role: 'admin',
  });
  expect(response.status).toBe(200);
  expect(response.body.period_end).toBe(periodEnd);
  return response.body as {
    period_end: string;
    preflight: {
      all_asset_accounts_reconciled: boolean;
      unreconciled_accounts: Array<{
        account_id: number;
        account_code: string;
        account_name: string;
        required_through_date: string;
        latest_closed_statement_date: string | null;
      }>;
    };
  };
}

async function createIsolatedHardCloseWindow(periodEnd: string) {
  const suffix = uniqueSuffix();
  const boundaryDate = dayBefore(dayBefore(periodEnd));
  const fiscalYear = await nextUnusedFutureFiscalYear();

  const [equityAccount] = await db('accounts')
    .insert({
      code: `HC-EQ-${suffix}`,
      name: `Hard Close Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create hard close equity account');
  createdAccountIds.push(equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Hard Close Fund ${suffix}`,
      description: 'Hard close isolated fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create hard close fixture fund');
  createdFundIds.push(fund.id);

  const [transaction] = await db('transactions')
    .insert({
      date: boundaryDate,
      description: `Hard Close Boundary ${suffix}`,
      reference_no: `HC-B-${suffix}`,
      fund_id: fund.id,
      created_by: null,
      is_closing_entry: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create hard close boundary transaction');
  createdTransactionIds.push(transaction.id);

  const [period] = await db('fiscal_periods')
    .insert({
      fiscal_year: fiscalYear,
      period_start: `${fiscalYear}-01-01`,
      period_end: boundaryDate,
      status: 'HARD_CLOSED',
      closing_transaction_id: transaction.id,
      closed_by: null,
      closed_at: db.fn.now(),
      created_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!period) throw new Error('Failed to create hard close boundary fiscal period');
  createdFiscalPeriodIds.push(period.id);

  return { fundId: fund.id };
}

async function createAssetAccountWithNoActivity() {
  const suffix = uniqueSuffix();
  const [assetAccount] = await db('accounts')
    .insert({
      code: `HC-INACTIVE-ASSET-${suffix}`,
      name: `Hard Close No Activity Asset ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id', 'code', 'name']) as Array<{ id: number; code: string; name: string }>;
  if (!assetAccount) throw new Error('Failed to create no-activity asset account fixture');
  createdAccountIds.push(assetAccount.id);
  return assetAccount;
}

async function createAssetActivityFixture(periodEnd: string) {
  const suffix = uniqueSuffix();
  const [assetAccount] = await db('accounts')
    .insert({
      code: `HC-ASSET-${suffix}`,
      name: `Hard Close Asset ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id', 'code', 'name']) as Array<{ id: number; code: string; name: string }>;
  if (!assetAccount) throw new Error('Failed to create hard close asset account');

  const [incomeAccount] = await db('accounts')
    .insert({
      code: `HC-INCOME-${suffix}`,
      name: `Hard Close Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!incomeAccount) throw new Error('Failed to create hard close income account');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `HC-EQUITY-${suffix}`,
      name: `Hard Close Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create hard close net asset account');
  createdAccountIds.push(assetAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Hard Close Tx Fund ${suffix}`,
      description: 'Hard close tx fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create hard close tx fund');
  createdFundIds.push(fund.id);

  const [transaction] = await db('transactions')
    .insert({
      date: periodEnd,
      description: `Hard Close Activity ${suffix}`,
      reference_no: `HC-A-${suffix}`,
      fund_id: fund.id,
      created_by: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create hard close activity transaction');
  createdTransactionIds.push(transaction.id);

  await db('journal_entries').insert([
    {
      transaction_id: transaction.id,
      account_id: assetAccount.id,
      fund_id: fund.id,
      debit: '10.00',
      credit: '0.00',
      memo: 'Hard close asset activity',
      is_reconciled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      transaction_id: transaction.id,
      account_id: incomeAccount.id,
      fund_id: fund.id,
      debit: '0.00',
      credit: '10.00',
      memo: 'Hard close income offset',
      is_reconciled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  return assetAccount;
}

async function createClosedReconciliation(accountId: number, statementDate: string) {
  const [reconciliation] = await db('reconciliations')
    .insert({
      account_id: accountId,
      statement_date: statementDate,
      statement_balance: '10.00',
      opening_balance: '0.00',
      is_closed: true,
      created_by: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!reconciliation) throw new Error('Failed to create hard close reconciliation fixture');
  createdReconciliationIds.push(reconciliation.id);
}

async function nextUnusedFutureFiscalYear() {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const fiscalYear = 2400 + Math.floor(Math.random() * 7000);
    const existing = await db('fiscal_periods')
      .where({ fiscal_year: fiscalYear })
      .first();
    if (!existing) return fiscalYear;
  }

  throw new Error('Failed to find an unused future fiscal year for fiscal period test');
}

async function nextUnusedFutureFiscalYearPair() {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const fiscalYear = 2400 + Math.floor(Math.random() * 6999);
    const existing = await db('fiscal_periods')
      .whereIn('fiscal_year', [fiscalYear, fiscalYear + 1]);
    if (existing.length === 0) return [fiscalYear, fiscalYear + 1] as const;
  }

  throw new Error('Failed to find unused future fiscal years for fiscal period test');
}

async function createReopenFixture(fiscalYear?: number) {
  const suffix = uniqueSuffix();
  const targetFiscalYear = fiscalYear ?? await nextUnusedFutureFiscalYear();
  const periodStart = `${targetFiscalYear}-01-01`;
  const periodEnd = `${targetFiscalYear}-12-31`;

  const [equityAccount] = await db('accounts')
    .insert({
      code: `FPEQ-${suffix}`,
      name: `Fiscal Period Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create fiscal period fixture account');
  createdAccountIds.push(equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Fiscal Period Fund ${suffix}`,
      description: 'Integration fiscal period fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create fiscal period fixture fund');
  createdFundIds.push(fund.id);

  const [transaction] = await db('transactions')
    .insert({
      date: periodEnd,
      description: `Fiscal Period Close ${suffix}`,
      reference_no: `FP-CLOSE-${suffix}`,
      fund_id: fund.id,
      created_by: null,
      is_closing_entry: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id']) as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create fiscal period fixture transaction');
  createdTransactionIds.push(transaction.id);

  const [period] = await db('fiscal_periods')
    .insert({
      fiscal_year: targetFiscalYear,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'HARD_CLOSED',
      closing_transaction_id: transaction.id,
      closed_by: null,
      closed_at: db.fn.now(),
      created_at: db.fn.now(),
    })
    .returning(['id', 'fiscal_year', 'period_end', 'closing_transaction_id']) as Array<{
      id: number;
      fiscal_year: number;
      period_end: string;
      closing_transaction_id: number;
    }>;
  if (!period) throw new Error('Failed to create fiscal period fixture period');
  createdFiscalPeriodIds.push(period.id);

  return { period, transaction };
}

describe('direct DB fiscal-periods integration smoke checks', () => {
  it('lists fiscal periods from the development database', async () => {
    const response = await requestRoute({
      probePath: '/',
      method: 'GET',
      role: 'admin',
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.fiscal_periods)).toBe(true);

    if (response.body.fiscal_periods.length > 0) {
      expect(response.body.fiscal_periods[0]).toEqual(expect.objectContaining({
        id: expect.any(Number),
        fiscal_year: expect.any(Number),
        period_start: expect.any(String),
        period_end: expect.any(String),
        status: 'HARD_CLOSED',
      }));
    }
  });

  it('investigates the next hard close window without mutating fiscal periods', async () => {
    const beforeCount = await db('fiscal_periods').count('id as count').first() as { count: string } | undefined;

    const response = await requestRoute({
      probePath: '/investigate',
      method: 'POST',
      role: 'admin',
    });

    expect([200, 409]).toContain(response.status);

    if (response.status === 200) {
      expect(response.body).toEqual(expect.objectContaining({
        fiscal_year: expect.any(Number),
        period_start: expect.any(String),
        period_end: expect.any(String),
        pro_forma_lines: expect.any(Array),
        preflight: expect.objectContaining({
          trial_balance_plugs: expect.any(Boolean),
          per_fund_balanced: expect.any(Boolean),
          all_asset_accounts_reconciled: expect.any(Boolean),
          unreconciled_accounts: expect.any(Array),
          no_unmapped_funds: expect.any(Boolean),
        }),
      }));

      const unreconciledAccounts = response.body.preflight.unreconciled_accounts;
      expect(Array.isArray(unreconciledAccounts)).toBe(true);
      if (unreconciledAccounts.length > 0) {
        expect(unreconciledAccounts[0]).toEqual(expect.objectContaining({
          account_id: expect.any(Number),
          account_code: expect.any(String),
          account_name: expect.any(String),
          required_through_date: response.body.period_end,
        }));
        expect(
          unreconciledAccounts[0].latest_closed_statement_date === null
          || typeof unreconciledAccounts[0].latest_closed_statement_date === 'string'
        ).toBe(true);
      }
    } else {
      expect(response.body).toEqual({ error: 'No closable prior year found.' });
    }

    const afterCount = await db('fiscal_periods').count('id as count').first() as { count: string } | undefined;
    expect(afterCount?.count).toBe(beforeCount?.count);
  });

  it('treats a closed reconciliation on period_end as reconciled', async () => {
    const baseline = await requireClosableInvestigation();
    await createIsolatedHardCloseWindow(baseline.period_end);
    const assetAccount = await createAssetActivityFixture(baseline.period_end);
    await createClosedReconciliation(assetAccount.id, baseline.period_end);

    const response = await requireClosableInvestigationForPeriod(baseline.period_end);
    const unreconciled = response.preflight.unreconciled_accounts.find((row) => row.account_id === assetAccount.id);

    expect(unreconciled).toBeUndefined();
  });

  it('reports an asset account when latest closed reconciliation is before period_end', async () => {
    const baseline = await requireClosableInvestigation();
    await createIsolatedHardCloseWindow(baseline.period_end);
    const assetAccount = await createAssetActivityFixture(baseline.period_end);
    const priorDate = dayBefore(baseline.period_end);
    await createClosedReconciliation(assetAccount.id, priorDate);

    const response = await requireClosableInvestigationForPeriod(baseline.period_end);
    const unreconciled = response.preflight.unreconciled_accounts.find((row) => row.account_id === assetAccount.id);

    expect(unreconciled).toEqual(expect.objectContaining({
      account_id: assetAccount.id,
      account_code: assetAccount.code,
      account_name: assetAccount.name,
      required_through_date: baseline.period_end,
      latest_closed_statement_date: priorDate,
    }));
  });

  it('reports an asset account when no closed reconciliation exists', async () => {
    const baseline = await requireClosableInvestigation();
    await createIsolatedHardCloseWindow(baseline.period_end);
    const assetAccount = await createAssetActivityFixture(baseline.period_end);

    const response = await requireClosableInvestigationForPeriod(baseline.period_end);
    const unreconciled = response.preflight.unreconciled_accounts.find((row) => row.account_id === assetAccount.id);

    expect(unreconciled).toEqual(expect.objectContaining({
      account_id: assetAccount.id,
      account_code: assetAccount.code,
      account_name: assetAccount.name,
      required_through_date: baseline.period_end,
      latest_closed_statement_date: null,
    }));
  });

  it('does not report an asset account with no activity in the close window', async () => {
    const baseline = await requireClosableInvestigation();
    await createIsolatedHardCloseWindow(baseline.period_end);
    const assetAccount = await createAssetAccountWithNoActivity();

    const response = await requireClosableInvestigationForPeriod(baseline.period_end);
    const unreconciled = response.preflight.unreconciled_accounts.find((row) => row.account_id === assetAccount.id);
    expect(unreconciled).toBeUndefined();
  });

  it('returns 404 when reopening a missing fiscal period', async () => {
    const response = await requestRoute({
      probePath: '/999999999/reopen',
      method: 'DELETE',
      role: 'admin',
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Fiscal period not found' });
  });

  it('reopens the latest hard-closed fiscal period and voids its closing transaction', async () => {
    const { period, transaction } = await createReopenFixture();

    const response = await requestRoute({
      probePath: `/${period.id}/reopen`,
      method: 'DELETE',
      role: 'admin',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Period reopened. Closing entry has been voided.' });

    const storedPeriod = await db('fiscal_periods')
      .where({ id: period.id })
      .first();
    expect(storedPeriod).toBeUndefined();
    createdFiscalPeriodIds.splice(createdFiscalPeriodIds.indexOf(period.id), 1);

    const storedTransaction = await db('transactions')
      .where({ id: transaction.id })
      .first() as { is_voided: boolean } | undefined;
    expect(storedTransaction).toEqual(expect.objectContaining({
      is_voided: true,
    }));
  });

  it('rejects reopening an older fiscal period while a later period remains closed', async () => {
    const [olderFiscalYear, laterFiscalYear] = await nextUnusedFutureFiscalYearPair();
    const older = await createReopenFixture(olderFiscalYear);
    await createReopenFixture(laterFiscalYear);

    const response = await requestRoute({
      probePath: `/${older.period.id}/reopen`,
      method: 'DELETE',
      role: 'admin',
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Cannot reopen a period when later periods are still closed. Reopen in reverse chronological order.',
    });

    const storedPeriod = await db('fiscal_periods')
      .where({ id: older.period.id })
      .first();
    expect(storedPeriod).toEqual(expect.objectContaining({
      id: older.period.id,
      fiscal_year: olderFiscalYear,
    }));

    const storedTransaction = await db('transactions')
      .where({ id: older.transaction.id })
      .first() as { is_voided: boolean } | undefined;
    expect(storedTransaction).toEqual(expect.objectContaining({
      is_voided: false,
    }));
  });
});
