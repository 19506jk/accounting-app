import dotenv from 'dotenv';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { UpdateTransactionInput } from '@shared/contracts';

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
            entries: [
              { account_id: fx.bankAccountId,   fund_id: fx.fundId, debit: 250,   credit: 0 },
              { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0,     credit: 250, payment_method: 'wire' as 'cash' },
            ],
          },
          fx.userId,
          ctx
        )
      ).rejects.toMatchObject({
        message: 'Validation failed',
        statusCode: 400,
        validationErrors: expect.arrayContaining([
          'Entry 2: payment_method must be one of: cash, cheque, e-transfer',
        ]),
      });
    });

    it('rejects payment_method on a debit entry', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      await expect(
        createTransaction(
          {
            date: '2026-05-01',
            description: 'Sunday deposit',
            entries: [
              { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: 'cash' },
              { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash' },
            ],
          },
          fx.userId,
          ctx
        )
      ).rejects.toMatchObject({
        message: 'Validation failed',
        statusCode: 400,
        validationErrors: expect.arrayContaining([
          'Entry 1: payment_method is only allowed on credit entries',
        ]),
      });
    });
  });

  describe('updateTransaction', () => {
    it('rejects an invalid per-entry payment_method value on update', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      const created = await createTransaction(
        {
          date: '2026-05-01',
          description: 'Cash deposit',
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash' },
          ],
        },
        fx.userId,
        ctx
      );
      createdTransactionIds.push(created.id);

      await expect(
        updateTransaction(String(created.id), {
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'wire' as 'cash' },
          ],
        }, ctx)
      ).rejects.toMatchObject({
        message: 'Validation failed',
        statusCode: 400,
        validationErrors: expect.arrayContaining([
          'Entry 2: payment_method must be one of: cash, cheque, e-transfer',
        ]),
      });
    });

    it('allows updating payment_method on reconciled entries while still blocking amount changes', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      const created = await createTransaction(
        {
          date: '2026-05-01',
          description: 'Cheque deposit',
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cheque' },
          ],
        },
        fx.userId,
        ctx
      );
      createdTransactionIds.push(created.id);

      await db('journal_entries')
        .where({ transaction_id: created.id })
        .update({ is_reconciled: true });

      const updated = await updateTransaction(String(created.id), {
        entries: [
          { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
          { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash' },
        ],
      }, ctx);

      expect(updated.entries?.[1]?.payment_method).toBe('cash');

      await expect(
        updateTransaction(String(created.id), {
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 249, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 249, payment_method: 'cash' },
          ],
        }, ctx)
      ).rejects.toMatchObject({
        message: 'Reconciled transactions only allow contact, memo, and payment method changes',
        statusCode: 400,
      });
    });

    it('allows reconciled memo-only updates when payment_method is omitted', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      const created = await createTransaction(
        {
          date: '2026-05-01',
          description: 'Reconciled memo edit',
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null, memo: 'bank row' },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash', memo: 'old memo' },
          ],
        },
        fx.userId,
        ctx
      );
      createdTransactionIds.push(created.id);

      await db('journal_entries')
        .where({ transaction_id: created.id })
        .update({ is_reconciled: true });

      const updated = await updateTransaction(
        String(created.id),
        {
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, memo: 'bank row' },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, memo: 'new memo' },
          ],
        } as unknown as UpdateTransactionInput,
        ctx
      );

      expect(updated.entries?.[1]?.memo).toBe('new memo');
      expect(updated.entries?.[1]?.payment_method).toBe('cash');
    });

    it('requires explicit payment_method fields for credit entries when updating entries', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      const created = await createTransaction(
        {
          date: '2026-05-01',
          description: 'Deposit update contract',
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash' },
          ],
        },
        fx.userId,
        ctx
      );
      createdTransactionIds.push(created.id);

      await expect(
        updateTransaction(String(created.id), {
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250 },
          ],
        } as unknown as UpdateTransactionInput, ctx)
      ).rejects.toMatchObject({
        message: 'Validation failed',
        statusCode: 400,
        validationErrors: expect.arrayContaining([
          'Entry 2: payment_method must be provided when updating entries',
        ]),
      });
    });

    it('returns not found before validating an invalid date on update', async () => {
      await expect(
        updateTransaction('999999999', {
          date: 'not-a-date',
        }, ctx)
      ).rejects.toMatchObject({
        message: 'Transaction not found',
        statusCode: 404,
      });
    });

    it('still validates an invalid date after finding a real transaction', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      const created = await createTransaction(
        {
          date: '2026-05-01',
          description: 'Real transaction date validation',
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash' },
          ],
        },
        fx.userId,
        ctx
      );
      createdTransactionIds.push(created.id);

      await expect(
        updateTransaction(String(created.id), {
          date: 'not-a-date',
        }, ctx)
      ).rejects.toMatchObject({
        message: 'date is not a valid date (YYYY-MM-DD)',
        statusCode: 400,
      });
    });

    it('returns batched transaction validation errors before missing update payment_method errors', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      const created = await createTransaction(
        {
          date: '2026-05-01',
          description: 'Deposit validation order',
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash' },
          ],
        },
        fx.userId,
        ctx
      );
      createdTransactionIds.push(created.id);

      await expect(
        updateTransaction(String(created.id), {
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: -250, credit: 0 },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash' },
          ],
        } as unknown as UpdateTransactionInput, ctx)
      ).rejects.toMatchObject({
        message: 'Validation failed',
        statusCode: 400,
        validationErrors: expect.arrayContaining([
          'Entry 1: amounts must be positive',
        ]),
      });
    });

    it('batches multiple missing payment_method errors on replacement updates', async () => {
      const fx = await createMinimalFixture();
      ctx.actor.id = fx.userId;

      const created = await createTransaction(
        {
          date: '2026-05-01',
          description: 'Deposit missing method batch',
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0, payment_method: null },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 250, payment_method: 'cash' },
          ],
        },
        fx.userId,
        ctx
      );
      createdTransactionIds.push(created.id);

      await expect(
        updateTransaction(String(created.id), {
          entries: [
            { account_id: fx.bankAccountId, fund_id: fx.fundId, debit: 250, credit: 0 },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 100 },
            { account_id: fx.incomeAccountId, fund_id: fx.fundId, debit: 0, credit: 150 },
          ],
        } as unknown as UpdateTransactionInput, ctx)
      ).rejects.toMatchObject({
        message: 'Validation failed',
        statusCode: 400,
        validationErrors: expect.arrayContaining([
          'Entry 2: payment_method must be provided when updating entries',
          'Entry 3: payment_method must be provided when updating entries',
        ]),
      });
    });
  });
});
