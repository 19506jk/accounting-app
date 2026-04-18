import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];

let reportsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const reportsModule = await import('../reports.js');
  reportsRouter = reportsModule.default as unknown as Router;
});

afterEach(async () => {
  if (createdTransactionIds.length > 0) {
    await db('transactions').whereIn('id', createdTransactionIds).delete();
    createdTransactionIds.length = 0;
  }

  if (createdContactIds.length > 0) {
    await db('contacts').whereIn('id', createdContactIds).delete();
    createdContactIds.length = 0;
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

async function requestRoute(probePath: string) {
  return requestMountedRoute({
    mountPath: '/api/reports',
    probePath,
    router: reportsRouter,
    role: 'viewer',
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

async function createDonationFixture() {
  const suffix = uniqueSuffix();
  const date = todayDateOnly();

  const [contact] = await db('contacts')
    .insert({
      type: 'DONOR',
      contact_class: 'INDIVIDUAL',
      name: `Report Donor ${suffix}`,
      donor_id: `RPT-DON-${suffix}`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string; donor_id: string; contact_class: string }>;
  if (!contact) throw new Error('Failed to create report fixture contact');
  createdContactIds.push(contact.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `RPTB-${suffix}`,
      name: `Report Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; code: string; name: string }>;
  if (!bankAccount) throw new Error('Failed to create report fixture bank account');

  const [incomeAccount] = await db('accounts')
    .insert({
      code: `RPTI-${suffix}`,
      name: `Report Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; code: string; name: string }>;
  if (!incomeAccount) throw new Error('Failed to create report fixture income account');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `RPTE-${suffix}`,
      name: `Report Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create report fixture equity account');

  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Report Fund ${suffix}`,
      description: 'Integration report fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string }>;
  if (!fund) throw new Error('Failed to create report fixture fund');
  createdFundIds.push(fund.id);

  const [transaction] = await db('transactions')
    .insert({
      date,
      description: `Report Donation ${suffix}`,
      reference_no: `RPT-${suffix}`,
      fund_id: fund.id,
      created_by: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; description: string; reference_no: string }>;
  if (!transaction) throw new Error('Failed to create report fixture transaction');
  createdTransactionIds.push(transaction.id);

  await db('journal_entries')
    .insert([
      {
        transaction_id: transaction.id,
        account_id: bankAccount.id,
        fund_id: fund.id,
        contact_id: null,
        debit: '40.00',
        credit: '0.00',
        memo: 'Bank deposit',
        is_reconciled: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        transaction_id: transaction.id,
        account_id: incomeAccount.id,
        fund_id: fund.id,
        contact_id: contact.id,
        debit: '0.00',
        credit: '40.00',
        memo: 'Report donation',
        is_reconciled: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ]);

  return {
    contact,
    bankAccount,
    incomeAccount,
    fund,
    transaction,
    date,
  };
}

describe('direct DB reports integration smoke checks', () => {
  it('returns P&L, ledger, donor summary, and donor detail from the development database', async () => {
    const fixture = await createDonationFixture();
    const range = `from=${fixture.date}&to=${fixture.date}`;

    const pl = await requestRoute(`/pl?${range}&fund_id=${fixture.fund.id}`);

    expect(pl.status).toBe(200);
    expect(pl.body.report).toEqual(expect.objectContaining({
      type: 'pl',
      filters: { from: fixture.date, to: fixture.date, fund_id: String(fixture.fund.id) },
    }));
    expect(pl.body.report.data).toEqual(expect.objectContaining({
      income: [
        {
          id: fixture.incomeAccount.id,
          code: fixture.incomeAccount.code,
          name: fixture.incomeAccount.name,
          amount: 40,
        },
      ],
      expenses: [],
      total_income: 40,
      total_expenses: 0,
      net_surplus: 40,
    }));

    const ledger = await requestRoute(`/ledger?${range}&fund_id=${fixture.fund.id}&account_id=${fixture.incomeAccount.id}`);

    expect(ledger.status).toBe(200);
    expect(ledger.body.report).toEqual(expect.objectContaining({
      type: 'ledger',
      filters: {
        from: fixture.date,
        to: fixture.date,
        fund_id: String(fixture.fund.id),
        account_id: String(fixture.incomeAccount.id),
      },
    }));
    expect(ledger.body.report.data.ledger).toEqual([
      expect.objectContaining({
        account: {
          id: fixture.incomeAccount.id,
          code: fixture.incomeAccount.code,
          name: fixture.incomeAccount.name,
          type: 'INCOME',
        },
        opening_balance: 0,
        closing_balance: 40,
        rows: [
          expect.objectContaining({
            date: fixture.date,
            description: fixture.transaction.description,
            reference_no: fixture.transaction.reference_no,
            contact_name: fixture.contact.name,
            fund_name: fixture.fund.name,
            debit: 0,
            credit: 40,
            memo: 'Report donation',
            balance: 40,
          }),
        ],
      }),
    ]);

    const donorSummary = await requestRoute(`/donors/summary?${range}&fund_id=${fixture.fund.id}&account_ids=${fixture.incomeAccount.id}`);

    expect(donorSummary.status).toBe(200);
    expect(donorSummary.body.report).toEqual(expect.objectContaining({
      type: 'donors-summary',
      filters: {
        from: fixture.date,
        to: fixture.date,
        fund_id: String(fixture.fund.id),
        account_ids: [fixture.incomeAccount.id],
      },
    }));
    expect(donorSummary.body.report.data).toEqual(expect.objectContaining({
      donors: [
        {
          contact_id: fixture.contact.id,
          contact_name: fixture.contact.name,
          contact_class: 'INDIVIDUAL',
          total: 40,
          transaction_count: 1,
        },
      ],
      anonymous: {
        total: 0,
        transaction_count: 0,
      },
      grand_total: 40,
      donor_count: 1,
    }));

    const donorDetail = await requestRoute(`/donors/detail?${range}&fund_id=${fixture.fund.id}&contact_id=${fixture.contact.id}&account_ids=${fixture.incomeAccount.id}`);

    expect(donorDetail.status).toBe(200);
    expect(donorDetail.body.report).toEqual(expect.objectContaining({
      type: 'donors-detail',
      filters: {
        from: fixture.date,
        to: fixture.date,
        fund_id: String(fixture.fund.id),
        contact_id: String(fixture.contact.id),
        account_ids: [fixture.incomeAccount.id],
      },
    }));
    expect(donorDetail.body.report.data).toEqual(expect.objectContaining({
      donors: [
        expect.objectContaining({
          contact_id: fixture.contact.id,
          contact_name: fixture.contact.name,
          contact_class: 'INDIVIDUAL',
          donor_id: fixture.contact.donor_id,
          total: 40,
          transactions: [
            expect.objectContaining({
              transaction_id: fixture.transaction.id,
              date: fixture.date,
              description: fixture.transaction.description,
              reference_no: fixture.transaction.reference_no,
              account_code: fixture.incomeAccount.code,
              account_name: fixture.incomeAccount.name,
              fund_name: fixture.fund.name,
              amount: 40,
              memo: 'Report donation',
            }),
          ],
        }),
      ],
      anonymous: null,
      grand_total: 40,
    }));
  });

  it('returns balance sheet and trial balance reports from the development database', async () => {
    const fixture = await createDonationFixture();

    const balanceSheet = await requestRoute(`/balance-sheet?as_of=${fixture.date}&fund_id=${fixture.fund.id}`);

    expect(balanceSheet.status).toBe(200);
    expect(balanceSheet.body.report).toEqual(expect.objectContaining({
      type: 'balance-sheet',
      filters: {
        as_of: fixture.date,
        fund_id: String(fixture.fund.id),
      },
    }));
    expect(balanceSheet.body.report.data).toEqual(expect.objectContaining({
      assets: [
        {
          id: fixture.bankAccount.id,
          code: fixture.bankAccount.code,
          name: fixture.bankAccount.name,
          balance: 40,
        },
      ],
      liabilities: [],
      total_assets: 40,
      total_liabilities: 0,
      total_equity: 40,
      total_liabilities_and_equity: 40,
      is_balanced: true,
      last_hard_close_date: null,
    }));
    expect(balanceSheet.body.report.data.equity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.any(String),
        name: `[System] Net Income (Current Year) - ${fixture.fund.name}`,
        balance: 40,
        is_synthetic: true,
        synthetic_note: `Synthetic current-year net income for ${fixture.fund.name}`,
        investigate_filters: expect.objectContaining({
          to: fixture.date,
          fund_id: fixture.fund.id,
          account_id: null,
        }),
      }),
    ]));
    expect(balanceSheet.body.report.data.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'BALANCED',
        severity: 'info',
        message: 'Balance Sheet is balanced.',
        fund_id: fixture.fund.id,
      }),
    ]));

    const trialBalance = await requestRoute(`/trial-balance?as_of=${fixture.date}&fund_id=${fixture.fund.id}`);

    expect(trialBalance.status).toBe(200);
    expect(trialBalance.body.report).toEqual(expect.objectContaining({
      type: 'trial-balance',
      filters: {
        as_of: fixture.date,
        fund_id: String(fixture.fund.id),
      },
    }));
    expect(trialBalance.body.report.data).toEqual(expect.objectContaining({
      grand_total_debit: 40,
      grand_total_credit: 40,
      is_balanced: true,
      as_of: fixture.date,
      last_hard_close_date: null,
    }));
    expect(trialBalance.body.report.data.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: fixture.bankAccount.id,
        code: fixture.bankAccount.code,
        name: fixture.bankAccount.name,
        type: 'ASSET',
        account_class: 'ASSET',
        normal_balance: 'DEBIT',
        net_side: 'DEBIT',
        net_debit: 40,
        net_credit: 0,
        total_debit: 40,
        total_credit: 0,
        is_abnormal_balance: false,
      }),
      expect.objectContaining({
        id: fixture.incomeAccount.id,
        code: fixture.incomeAccount.code,
        name: fixture.incomeAccount.name,
        type: 'INCOME',
        account_class: 'INCOME',
        normal_balance: 'CREDIT',
        net_side: 'CREDIT',
        net_debit: 0,
        net_credit: 40,
        total_debit: 0,
        total_credit: 40,
        is_abnormal_balance: false,
      }),
    ]));
    expect(trialBalance.body.report.data.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'BALANCED',
        severity: 'info',
        message: 'Trial Balance is balanced.',
        fund_id: fixture.fund.id,
      }),
    ]));
  });
});
