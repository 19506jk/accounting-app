import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from './routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

const createdTransactionIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

let transactionsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const transactionsModule = await import('./transactions.js');
  transactionsRouter = transactionsModule.default as unknown as Router;
});

afterEach(async () => {
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
  method: 'GET' | 'POST' | 'DELETE';
  userId: number;
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/transactions',
    probePath,
    method,
    router: transactionsRouter,
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

  const [user] = await db('users')
    .insert({
      google_id: `integration-user-${suffix}`,
      email: `transaction-user-${suffix}@example.com`,
      name: `Transaction User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create transaction fixture user');
  createdUserIds.push(user.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `ITBANK-${suffix}`,
      name: `Integration Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount) throw new Error('Failed to create transaction fixture bank account');

  const [incomeAccount] = await db('accounts')
    .insert({
      code: `ITINC-${suffix}`,
      name: `Integration Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!incomeAccount) throw new Error('Failed to create transaction fixture income account');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `ITEQ-${suffix}`,
      name: `Integration Fund Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create transaction fixture equity account');

  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Integration Transaction Fund ${suffix}`,
      description: 'Integration transaction fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create transaction fixture fund');

  createdFundIds.push(fund.id);

  return {
    userId: user.id,
    bankAccountId: bankAccount.id,
    incomeAccountId: incomeAccount.id,
    fundId: fund.id,
    suffix,
  };
}

describe('direct DB transactions integration smoke checks', () => {
  it('creates, reads, lists, and deletes a transaction using the development database', async () => {
    const fixture = await createFixture();
    const date = todayDateOnly();
    const description = `Integration Transaction ${fixture.suffix}`;
    const referenceNo = `ITX-${fixture.suffix}`;

    const created = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
      body: {
        date,
        description,
        reference_no: referenceNo,
        entries: [
          {
            account_id: fixture.bankAccountId,
            fund_id: fixture.fundId,
            debit: 25,
            memo: 'Bank deposit',
          },
          {
            account_id: fixture.incomeAccountId,
            fund_id: fixture.fundId,
            credit: 25,
            memo: 'Donation income',
          },
        ],
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.transaction).toEqual(expect.objectContaining({
      id: expect.any(Number),
      date,
      description,
      reference_no: referenceNo,
      fund_id: fixture.fundId,
      created_by: fixture.userId,
      is_voided: false,
    }));
    expect(created.body.transaction.entries).toHaveLength(2);

    const transactionId = created.body.transaction.id as number;
    createdTransactionIds.push(transactionId);

    const found = await requestRoute({
      probePath: `/${transactionId}`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(found.status).toBe(200);
    expect(found.body.transaction).toEqual(expect.objectContaining({
      id: transactionId,
      date,
      description,
      reference_no: referenceNo,
      total_amount: 25,
      is_voided: false,
    }));
    expect(found.body.transaction.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        debit: 25,
        credit: 0,
      }),
      expect.objectContaining({
        account_id: fixture.incomeAccountId,
        fund_id: fixture.fundId,
        debit: 0,
        credit: 25,
      }),
    ]));

    const listed = await requestRoute({
      probePath: `/?fund_id=${fixture.fundId}&account_id=${fixture.incomeAccountId}&from=${date}&to=${date}&limit=10&offset=0`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(expect.objectContaining({
      total: 1,
      limit: 10,
      offset: 0,
    }));
    expect(listed.body.transactions).toEqual([
      expect.objectContaining({
        id: transactionId,
        date,
        description,
        reference_no: referenceNo,
        fund_id: fixture.fundId,
        total_amount: 25,
        transaction_type: 'deposit',
        is_voided: false,
      }),
    ]);

    const deleted = await requestRoute({
      probePath: `/${transactionId}`,
      method: 'DELETE',
      userId: fixture.userId,
      role: 'admin',
    });

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: 'Transaction deleted successfully' });
    createdTransactionIds.splice(createdTransactionIds.indexOf(transactionId), 1);

    const stored = await db('transactions').where({ id: transactionId }).first();
    expect(stored).toBeUndefined();
  });

  it('rejects unbalanced transaction creation before inserting rows', async () => {
    const fixture = await createFixture();
    const description = `Unbalanced Transaction ${fixture.suffix}`;

    const rejected = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
      body: {
        date: todayDateOnly(),
        description,
        entries: [
          {
            account_id: fixture.bankAccountId,
            fund_id: fixture.fundId,
            debit: 25,
          },
          {
            account_id: fixture.incomeAccountId,
            fund_id: fixture.fundId,
            credit: 20,
          },
        ],
      },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body.errors).toEqual(expect.arrayContaining([
      'Transaction is not balanced. Debits $25.00 ≠ credits $20.00',
      `"Integration Transaction Fund ${fixture.suffix}" is not balanced. Debits $25.00 ≠ credits $20.00`,
    ]));

    const inserted = await db('transactions')
      .where({ description })
      .first();
    expect(inserted).toBeUndefined();
  });
});
