import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdReconciliationIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

let reconciliationRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const reconciliationModule = await import('../reconciliation.js');
  reconciliationRouter = reconciliationModule.default as unknown as Router;
});

afterEach(async () => {
  if (createdReconciliationIds.length > 0) {
    await db('reconciliations').whereIn('id', createdReconciliationIds).delete();
    createdReconciliationIds.length = 0;
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

  if (createdUserIds.length > 0) {
    await db('users').whereIn('id', createdUserIds).delete();
    createdUserIds.length = 0;
  }
});

async function requestRoute({
  probePath,
  method,
  userId,
  role = 'admin',
  body,
}: {
  probePath: string;
  method: 'GET' | 'POST';
  userId: number;
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/reconciliations',
    probePath,
    method,
    router: reconciliationRouter,
    userId,
    role,
    body,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

async function createFixture() {
  const suffix = uniqueSuffix();
  const date = todayDateOnly();

  const [user] = await db('users')
    .insert({
      google_id: `reconciliation-user-${suffix}`,
      email: `reconciliation-user-${suffix}@example.com`,
      name: `Reconciliation User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create reconciliation fixture user');
  createdUserIds.push(user.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `IRBANK-${suffix}`,
      name: `Integration Reconciliation Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount) throw new Error('Failed to create reconciliation fixture bank account');

  const [incomeAccount] = await db('accounts')
    .insert({
      code: `IRINC-${suffix}`,
      name: `Integration Reconciliation Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!incomeAccount) throw new Error('Failed to create reconciliation fixture income account');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `IREQ-${suffix}`,
      name: `Integration Reconciliation Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create reconciliation fixture equity account');

  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Integration Reconciliation Fund ${suffix}`,
      description: 'Integration reconciliation fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create reconciliation fixture fund');
  createdFundIds.push(fund.id);

  const [transaction] = await db('transactions')
    .insert({
      date,
      description: `Integration Reconciliation Transaction ${suffix}`,
      reference_no: `IR-${suffix}`,
      fund_id: fund.id,
      created_by: user.id,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create reconciliation fixture transaction');
  createdTransactionIds.push(transaction.id);

  const entries = await db('journal_entries')
    .insert([
      {
        transaction_id: transaction.id,
        account_id: bankAccount.id,
        fund_id: fund.id,
        debit: '25.00',
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
        debit: '0.00',
        credit: '25.00',
        memo: 'Donation income',
        is_reconciled: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ])
    .returning('*') as Array<{ id: number; account_id: number }>;

  const bankEntry = entries.find((entry) => entry.account_id === bankAccount.id);
  if (!bankEntry) throw new Error('Failed to create reconciliation fixture bank journal entry');

  return {
    userId: user.id,
    bankAccountId: bankAccount.id,
    bankEntryId: bankEntry.id,
    date,
  };
}

describe('direct DB reconciliation integration smoke checks', () => {
  it('creates, clears, closes, and lists a reconciliation using the development database', async () => {
    const fixture = await createFixture();

    const created = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
      body: {
        account_id: fixture.bankAccountId,
        statement_date: fixture.date,
        statement_balance: 25,
        opening_balance: 0,
      },
    });

    expect(created.status).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({
      items_loaded: 1,
      reconciliation: expect.objectContaining({
        id: expect.any(Number),
        account_id: fixture.bankAccountId,
        is_closed: false,
      }),
    }));

    const reconciliationId = created.body.reconciliation.id as number;
    createdReconciliationIds.push(reconciliationId);

    const found = await requestRoute({
      probePath: `/${reconciliationId}`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(found.status).toBe(200);
    expect(found.body.reconciliation).toEqual(expect.objectContaining({
      id: reconciliationId,
      account_id: fixture.bankAccountId,
      statement_balance: 25,
      opening_balance: 0,
      cleared_balance: 0,
      difference: 25,
      status: 'UNBALANCED',
    }));
    expect(found.body.reconciliation.items).toEqual([
      expect.objectContaining({
        journal_entry_id: fixture.bankEntryId,
        is_cleared: false,
        debit: 25,
        credit: 0,
      }),
    ]);

    const itemId = found.body.reconciliation.items[0].id as number;
    const cleared = await requestRoute({
      probePath: `/${reconciliationId}/items/${itemId}/clear`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });

    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual(expect.objectContaining({
      item: expect.objectContaining({
        id: itemId,
        reconciliation_id: reconciliationId,
        journal_entry_id: fixture.bankEntryId,
        is_cleared: true,
      }),
      cleared_balance: 25,
      difference: 0,
      status: 'BALANCED',
    }));

    const closed = await requestRoute({
      probePath: `/${reconciliationId}/close`,
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
    });

    expect(closed.status).toBe(200);
    expect(closed.body).toEqual(expect.objectContaining({
      message: 'Reconciliation closed successfully',
      summary: expect.objectContaining({
        total_items: 1,
        cleared_items: 1,
        uncleared_items: 0,
        cleared_debits: 25,
      }),
    }));

    const bankEntry = await db('journal_entries')
      .where({ id: fixture.bankEntryId })
      .first() as { is_reconciled: boolean } | undefined;
    expect(bankEntry?.is_reconciled).toBe(true);

    const listed = await requestRoute({
      probePath: '/',
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(listed.status).toBe(200);
    expect(listed.body.reconciliations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: reconciliationId,
        account_id: fixture.bankAccountId,
        is_closed: true,
      }),
    ]));
  });
});
