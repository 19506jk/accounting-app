import dotenv from 'dotenv';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

dotenv.config();

const db = require('../../../db') as Knex;

let createTransaction: (typeof import('../../transactions.js'))['createTransaction'];
let updateTransaction: (typeof import('../../transactions.js'))['updateTransaction'];

const createdTransactionIds: number[] = [];
const createdAccountIds: number[] = [];
const createdFundIds: number[] = [];
const createdUserIds: number[] = [];

beforeAll(async () => {
  await db.raw('select 1');
  const mod = await import('../../transactions.js');
  createTransaction = mod.createTransaction;
  updateTransaction = mod.updateTransaction;
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

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

async function createMinimalFixture() {
  const suffix = uniqueSuffix();

  const [user] = await db('users')
    .insert({
      google_id: `pm-val-${suffix}`,
      email: `pm-val-${suffix}@example.com`,
      name: `PM Validation ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create user');
  createdUserIds.push(user.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `PMVAL-BANK-${suffix}`,
      name: `PM Val Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [incomeAccount] = await db('accounts')
    .insert({
      code: `PMVAL-INC-${suffix}`,
      name: `PM Val Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `PMVAL-EQ-${suffix}`,
      name: `PM Val Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount || !incomeAccount || !equityAccount) throw new Error('Failed to create accounts');
  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `PM Val Fund ${suffix}`,
      description: 'payment method validation test fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create fund');
  createdFundIds.push(fund.id);

  return { userId: user.id, bankAccountId: bankAccount.id, incomeAccountId: incomeAccount.id, fundId: fund.id };
}

const ctx = {
  sessionToken: undefined as string | undefined,
  actor: { id: 0, name: 'Test', email: 'test@example.com', role: 'admin' },
};

describe('payment_method validation', () => {
  describe('createTransaction', () => {
    it('rejects an invalid payment_method value', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      await expect(
        createTransaction(
          {
            date: '2026-05-01',
            description: 'Sunday deposit',
            payment_method: 'wire' as 'cash',
            entries: [
              { account_id: fx.bankAccountId,   fund_id: fx.fundId, debit: 250,   credit: 0 },
              { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0,     credit: 250 },
            ],
          },
          fx.userId,
          ctx
        )
      ).rejects.toMatchObject({
        message: 'Validation failed',
        statusCode: 400,
        validationErrors: expect.arrayContaining([
          'payment_method must be one of: cash, cheque, e-transfer',
        ]),
      });
    });
  });

  describe('updateTransaction', () => {
    it('rejects an invalid payment_method value on header-only update', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      // Insert a minimal transaction directly to avoid going through createTransaction
      const [tx] = await db('transactions')
        .insert({
          date: '2026-05-01',
          description: 'Cash deposit',
          payment_method: 'cash',
          fund_id: fx.fundId,
          created_by: fx.userId,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning('*') as Array<{ id: number }>;
      if (!tx) throw new Error('Failed to insert transaction');
      createdTransactionIds.push(tx.id);

      await expect(
        updateTransaction(String(tx.id), { payment_method: 'wire' as 'cash' }, ctx)
      ).rejects.toMatchObject({
        message: 'payment_method must be one of: cash, cheque, e-transfer',
        statusCode: 400,
      });
    });
  });
});
