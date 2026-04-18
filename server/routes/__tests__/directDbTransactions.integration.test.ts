import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';


dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdBillIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

let transactionsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const transactionsModule = await import('../transactions.js');
  transactionsRouter = transactionsModule.default as unknown as Router;
});

afterEach(async () => {
  if (createdBillIds.length > 0) {
    await db('bills').whereIn('id', createdBillIds).delete();
    createdBillIds.length = 0;
  }

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

  const [expenseAccount] = await db('accounts')
    .insert({
      code: `ITEXP-${suffix}`,
      name: `Integration Expense ${suffix}`,
      type: 'EXPENSE',
      account_class: 'EXPENSE',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!expenseAccount) throw new Error('Failed to create transaction fixture expense account');

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

  createdAccountIds.push(bankAccount.id, incomeAccount.id, expenseAccount.id, equityAccount.id);

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
    expenseAccountId: expenseAccount.id,
    fundId: fund.id,
    suffix,
  };
}

async function createVendor(suffix: string) {
  const [vendor] = await db('contacts')
    .insert({
      type: 'PAYEE',
      contact_class: 'INDIVIDUAL',
      name: `Transaction Match Vendor ${suffix}`,
      email: `transaction-match-vendor-${suffix}@example.com`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string }>;
  if (!vendor) throw new Error('Failed to create transaction match vendor');
  createdContactIds.push(vendor.id);
  return vendor;
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

  it('validates import bill match input and returns exact and possible bill matches', async () => {
    const fixture = await createFixture();
    const vendor = await createVendor(fixture.suffix);
    const exactAmount = 9700.11;
    const possibleAmount = 9700.22;

    const rejected = await requestRoute({
      probePath: '/import/bill-matches',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        bank_account_id: 0,
        rows: [],
      },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body.errors).toEqual([
      'bank_account_id must be a positive integer',
      'rows must be a non-empty array',
    ]);

    const bills = await db('bills')
      .insert([
        {
          contact_id: vendor.id,
          date: '2026-04-01',
          due_date: '2026-04-15',
          bill_number: `MATCH-EXACT-${fixture.suffix}`,
          description: `Exact Match Bill ${fixture.suffix}`,
          amount: exactAmount.toFixed(2),
          amount_paid: '0.00',
          status: 'UNPAID',
          fund_id: fixture.fundId,
          created_by: fixture.userId,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        },
        {
          contact_id: vendor.id,
          date: '2026-01-01',
          due_date: '2026-01-15',
          bill_number: `MATCH-POSSIBLE-${fixture.suffix}`,
          description: `Possible Match Bill ${fixture.suffix}`,
          amount: possibleAmount.toFixed(2),
          amount_paid: '0.00',
          status: 'UNPAID',
          fund_id: fixture.fundId,
          created_by: fixture.userId,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        },
        {
          contact_id: vendor.id,
          date: '2026-04-01',
          due_date: '2026-04-15',
          bill_number: `MATCH-PAID-${fixture.suffix}`,
          description: `Paid Match Bill ${fixture.suffix}`,
          amount: exactAmount.toFixed(2),
          amount_paid: exactAmount.toFixed(2),
          status: 'PAID',
          fund_id: fixture.fundId,
          created_by: fixture.userId,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        },
      ])
      .returning(['id', 'bill_number']) as Array<{ id: number; bill_number: string }>;
    createdBillIds.push(...bills.map((bill) => bill.id));

    const exactBill = bills.find((bill) => bill.bill_number === `MATCH-EXACT-${fixture.suffix}`);
    const possibleBill = bills.find((bill) => bill.bill_number === `MATCH-POSSIBLE-${fixture.suffix}`);
    if (!exactBill || !possibleBill) throw new Error('Failed to create bill match fixtures');

    const matched = await requestRoute({
      probePath: '/import/bill-matches',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        bank_account_id: fixture.bankAccountId,
        rows: [
          {
            row_index: 1,
            date: '2026-04-17',
            amount: exactAmount,
            type: 'withdrawal',
          },
          {
            row_index: 2,
            date: '2026-04-17',
            amount: possibleAmount,
            type: 'withdrawal',
          },
          {
            row_index: 3,
            date: '2026-04-17',
            amount: exactAmount,
            type: 'deposit',
          },
        ],
      },
    });

    expect(matched.status).toBe(200);
    expect(matched.body.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        row_index: 1,
        bill_id: exactBill.id,
        bill_number: `MATCH-EXACT-${fixture.suffix}`,
        vendor_name: vendor.name,
        bill_date: '2026-04-01',
        due_date: '2026-04-15',
        balance_due: exactAmount,
        confidence: 'exact',
      }),
      expect.objectContaining({
        row_index: 2,
        bill_id: possibleBill.id,
        bill_number: `MATCH-POSSIBLE-${fixture.suffix}`,
        vendor_name: vendor.name,
        bill_date: '2026-01-01',
        due_date: '2026-01-15',
        balance_due: possibleAmount,
        confidence: 'possible',
      }),
    ]));
    expect(matched.body.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ row_index: 3 }),
    ]));
  });

  it('imports plain deposit and withdrawal rows and skips duplicate references', async () => {
    const fixture = await createFixture();
    const vendor = await createVendor(fixture.suffix);
    const depositReference = `IMP-DEP-${fixture.suffix}`;
    const withdrawalReference = `IMP-WDR-${fixture.suffix}`;

    const rejected = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        bank_account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        rows: [
          {
            date: 'not-a-date',
            description: '',
            reference_no: `IMP-BAD-${fixture.suffix}`,
            amount: -1,
            type: 'transfer',
            offset_account_id: fixture.bankAccountId,
          },
          {
            date: '2026-04-17',
            description: `Invalid Deposit ${fixture.suffix}`,
            amount: 10,
            type: 'deposit',
            offset_account_id: 999999999,
            contact_id: -1,
          },
          {
            date: '2026-04-17',
            description: `Invalid Withdrawal ${fixture.suffix}`,
            amount: 5,
            type: 'withdrawal',
            offset_account_id: 0,
            payee_id: -1,
          },
        ],
      },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body.errors).toEqual(expect.arrayContaining([
      'Row 1: date must be a valid YYYY-MM-DD value',
      'Row 1: description is required',
      'Row 1: amount must be greater than 0',
      "Row 1: type must be 'withdrawal' or 'deposit'",
      'Row 1: offset_account_id cannot be the same as bank_account_id',
      'Row 2: contact_id must be a positive integer when provided',
      'Row 2: offset account #999999999 does not exist or is inactive',
      'Row 3: offset_account_id must be a positive integer',
      'Row 3: payee_id must be a positive integer when provided',
    ]));

    const imported = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        bank_account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        rows: [
          {
            date: '2026-04-17',
            description: `Imported Deposit ${fixture.suffix}`,
            reference_no: depositReference,
            amount: 11.25,
            type: 'deposit',
            offset_account_id: fixture.incomeAccountId,
            contact_id: vendor.id,
          },
          {
            date: '2026-04-17',
            description: `Imported Withdrawal ${fixture.suffix}`,
            reference_no: withdrawalReference,
            amount: 7.5,
            type: 'withdrawal',
            offset_account_id: fixture.expenseAccountId,
            payee_id: vendor.id,
          },
        ],
      },
    });

    expect(imported.status).toBe(200);
    expect(imported.body).toEqual({
      imported: 2,
      skipped: 0,
      skipped_rows: [],
    });

    const transactions = await db('transactions')
      .whereIn('reference_no', [depositReference, withdrawalReference])
      .orderBy('reference_no', 'asc') as Array<{
        id: number;
        reference_no: string;
        description: string;
        fund_id: number;
        created_by: number;
      }>;
    createdTransactionIds.push(...transactions.map((transaction) => transaction.id));

    expect(transactions).toEqual([
      expect.objectContaining({
        reference_no: depositReference,
        description: `Imported Deposit ${fixture.suffix}`,
        fund_id: fixture.fundId,
        created_by: fixture.userId,
      }),
      expect.objectContaining({
        reference_no: withdrawalReference,
        description: `Imported Withdrawal ${fixture.suffix}`,
        fund_id: fixture.fundId,
        created_by: fixture.userId,
      }),
    ]);

    const entries = await db('journal_entries')
      .whereIn('transaction_id', transactions.map((transaction) => transaction.id))
      .orderBy('transaction_id', 'asc')
      .orderBy('id', 'asc') as Array<{
        transaction_id: number;
        account_id: number;
        fund_id: number;
        contact_id: number | null;
        debit: string | number;
        credit: string | number;
      }>;

    const deposit = transactions.find((transaction) => transaction.reference_no === depositReference);
    const withdrawal = transactions.find((transaction) => transaction.reference_no === withdrawalReference);
    if (!deposit || !withdrawal) throw new Error('Expected imported transactions to be present');

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transaction_id: deposit.id,
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        contact_id: vendor.id,
        debit: '11.25',
        credit: '0.00',
      }),
      expect.objectContaining({
        transaction_id: deposit.id,
        account_id: fixture.incomeAccountId,
        fund_id: fixture.fundId,
        contact_id: vendor.id,
        debit: '0.00',
        credit: '11.25',
      }),
      expect.objectContaining({
        transaction_id: withdrawal.id,
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        contact_id: vendor.id,
        debit: '0.00',
        credit: '7.50',
      }),
      expect.objectContaining({
        transaction_id: withdrawal.id,
        account_id: fixture.expenseAccountId,
        fund_id: fixture.fundId,
        contact_id: vendor.id,
        debit: '7.50',
        credit: '0.00',
      }),
    ]));

    const duplicate = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        bank_account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        rows: [
          {
            date: '2026-04-17',
            description: `Imported Deposit ${fixture.suffix}`,
            reference_no: depositReference,
            amount: 11.25,
            type: 'deposit',
            offset_account_id: fixture.incomeAccountId,
            contact_id: vendor.id,
          },
          {
            date: '2026-04-17',
            description: `Imported Withdrawal ${fixture.suffix}`,
            reference_no: withdrawalReference,
            amount: 7.5,
            type: 'withdrawal',
            offset_account_id: fixture.expenseAccountId,
            payee_id: vendor.id,
          },
        ],
      },
    });

    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({
      imported: 0,
      skipped: 2,
      skipped_rows: [
        expect.objectContaining({
          row_index: 1,
          reason: `Duplicate import detected for reference number ${depositReference}`,
          reference_no: depositReference,
        }),
        expect.objectContaining({
          row_index: 2,
          reason: `Duplicate import detected for reference number ${withdrawalReference}`,
          reference_no: withdrawalReference,
        }),
      ],
    });
  });
});
