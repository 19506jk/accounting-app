import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from './routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

const createdBillIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

let billsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const billsModule = await import('./bills.js');
  billsRouter = billsModule.default as unknown as Router;
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
  method: 'GET' | 'POST';
  userId: number;
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/bills',
    probePath,
    method,
    router: billsRouter,
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
      google_id: `bill-user-${suffix}`,
      email: `bill-user-${suffix}@example.com`,
      name: `Bill User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create bill fixture user');
  createdUserIds.push(user.id);

  const [vendor] = await db('contacts')
    .insert({
      type: 'PAYEE',
      contact_class: 'INDIVIDUAL',
      name: `Integration Vendor ${suffix}`,
      email: `vendor-${suffix}@example.com`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string }>;
  if (!vendor) throw new Error('Failed to create bill fixture vendor');
  createdContactIds.push(vendor.id);

  const [expenseAccount] = await db('accounts')
    .insert({
      code: `IBEXP-${suffix}`,
      name: `Integration Bill Expense ${suffix}`,
      type: 'EXPENSE',
      account_class: 'EXPENSE',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; code: string; name: string }>;
  if (!expenseAccount) throw new Error('Failed to create bill fixture expense account');
  createdAccountIds.push(expenseAccount.id);

  const apAccount = await db('accounts')
    .where({ code: '20000', is_active: true })
    .first() as { id: number } | undefined;
  if (!apAccount) throw new Error('Expected active Accounts Payable account 20000 in development database');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `IBEQ-${suffix}`,
      name: `Integration Bill Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create bill fixture equity account');
  createdAccountIds.push(equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Integration Bill Fund ${suffix}`,
      description: 'Integration bill fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string }>;
  if (!fund) throw new Error('Failed to create bill fixture fund');
  createdFundIds.push(fund.id);

  return {
    userId: user.id,
    vendor,
    expenseAccount,
    apAccount,
    fund,
    suffix,
  };
}

describe('direct DB bills integration smoke checks', () => {
  it('creates, reads, lists, and voids a bill using the development database', async () => {
    const fixture = await createFixture();
    const date = todayDateOnly();
    const billNumber = `BILL-${fixture.suffix}`;
    const description = `Integration Bill ${fixture.suffix}`;

    const created = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
      body: {
        contact_id: fixture.vendor.id,
        date,
        due_date: date,
        bill_number: billNumber,
        description,
        amount: 30,
        fund_id: fixture.fund.id,
        line_items: [
          {
            expense_account_id: fixture.expenseAccount.id,
            amount: 30,
            description: 'Office supplies',
          },
        ],
      },
    });

    expect(created.status).toBe(201);
    const billId = created.body.bill.id as number;
    const transactionId = created.body.transaction.id as number;
    createdBillIds.push(billId);
    createdTransactionIds.push(transactionId);

    expect(created.body.bill).toEqual(expect.objectContaining({
      id: expect.any(Number),
      contact_id: fixture.vendor.id,
      date,
      due_date: date,
      bill_number: billNumber,
      description,
      amount: 30,
      amount_paid: 0,
      status: 'UNPAID',
      fund_id: fixture.fund.id,
      created_by: fixture.userId,
      vendor_name: fixture.vendor.name,
      fund_name: fixture.fund.name,
    }));
    expect(created.body.bill.line_items).toEqual([
      expect.objectContaining({
        expense_account_id: fixture.expenseAccount.id,
        expense_account_code: fixture.expenseAccount.code,
        expense_account_name: fixture.expenseAccount.name,
        amount: 30,
        rounding_adjustment: 0,
        description: 'Office supplies',
      }),
    ]);
    expect(created.body.transaction).toEqual(expect.objectContaining({
      id: expect.any(Number),
      date: expect.any(String),
      reference_no: billNumber,
      fund_id: fixture.fund.id,
      created_by: fixture.userId,
    }));

    const entries = await db('journal_entries')
      .where({ transaction_id: transactionId })
      .orderBy('id', 'asc') as Array<{
        account_id: number;
        fund_id: number;
        contact_id: number | null;
        debit: string | number;
        credit: string | number;
      }>;

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        account_id: fixture.expenseAccount.id,
        fund_id: fixture.fund.id,
        contact_id: null,
        debit: '30.00',
        credit: '0.00',
      }),
      expect.objectContaining({
        account_id: fixture.apAccount.id,
        fund_id: fixture.fund.id,
        contact_id: fixture.vendor.id,
        debit: '0.00',
        credit: '30.00',
      }),
    ]));

    const found = await requestRoute({
      probePath: `/${billId}`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(found.status).toBe(200);
    expect(found.body.bill).toEqual(expect.objectContaining({
      id: billId,
      bill_number: billNumber,
      amount: 30,
      status: 'UNPAID',
      created_transaction_id: transactionId,
      is_voided: false,
    }));

    const listed = await requestRoute({
      probePath: `/?status=UNPAID&contact_id=${fixture.vendor.id}&from=${date}&to=${date}&limit=10&offset=0`,
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
    expect(listed.body.bills).toEqual([
      expect.objectContaining({
        id: billId,
        bill_number: billNumber,
        vendor_name: fixture.vendor.name,
        fund_name: fixture.fund.name,
        amount: 30,
        status: 'UNPAID',
        line_items: [
          expect.objectContaining({
            expense_account_id: fixture.expenseAccount.id,
            amount: 30,
          }),
        ],
      }),
    ]);

    const voided = await requestRoute({
      probePath: `/${billId}/void`,
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
    });

    expect(voided.status).toBe(200);
    expect(voided.body.bill).toEqual(expect.objectContaining({
      id: billId,
      status: 'VOID',
    }));

    const storedTransaction = await db('transactions')
      .where({ id: transactionId })
      .first() as { is_voided: boolean } | undefined;
    expect(storedTransaction?.is_voided).toBe(true);
  });

  it('lists, applies, and unapplies vendor credits using the development database', async () => {
    const fixture = await createFixture();
    const date = todayDateOnly();

    const target = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
      body: {
        contact_id: fixture.vendor.id,
        date,
        due_date: date,
        bill_number: `BILL-CREDIT-TARGET-${fixture.suffix}`,
        description: `Integration Credit Target ${fixture.suffix}`,
        amount: 100,
        fund_id: fixture.fund.id,
        line_items: [
          {
            expense_account_id: fixture.expenseAccount.id,
            amount: 100,
            description: 'Target bill',
          },
        ],
      },
    });

    expect(target.status).toBe(201);
    const targetBillId = target.body.bill.id as number;
    createdBillIds.push(targetBillId);
    createdTransactionIds.push(target.body.transaction.id as number);

    const credit = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
      body: {
        contact_id: fixture.vendor.id,
        date,
        due_date: date,
        bill_number: `BILL-CREDIT-SOURCE-${fixture.suffix}`,
        description: `Integration Vendor Credit ${fixture.suffix}`,
        amount: -30,
        fund_id: fixture.fund.id,
        line_items: [
          {
            expense_account_id: fixture.expenseAccount.id,
            amount: -30,
            description: 'Vendor credit',
          },
        ],
      },
    });

    expect(credit.status).toBe(201);
    const creditBillId = credit.body.bill.id as number;
    createdBillIds.push(creditBillId);
    createdTransactionIds.push(credit.body.transaction.id as number);

    const available = await requestRoute({
      probePath: `/${targetBillId}/available-credits`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(available.status).toBe(200);
    expect(available.body).toEqual(expect.objectContaining({
      target_bill_id: targetBillId,
      target_outstanding: 100,
    }));
    expect(available.body.credits).toEqual([
      expect.objectContaining({
        bill_id: creditBillId,
        bill_number: `BILL-CREDIT-SOURCE-${fixture.suffix}`,
        original_amount: -30,
        amount_paid: 0,
        outstanding: -30,
        available_amount: 30,
      }),
    ]);

    const overApplied = await requestRoute({
      probePath: `/${targetBillId}/apply-credits`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        applications: [
          {
            credit_bill_id: creditBillId,
            amount: 30.01,
          },
        ],
      },
    });

    expect(overApplied.status).toBe(400);
    expect(overApplied.body.errors).toEqual([
      `Credit bill #BILL-CREDIT-SOURCE-${fixture.suffix} exceeds available balance`,
    ]);

    const applied = await requestRoute({
      probePath: `/${targetBillId}/apply-credits`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        applications: [
          {
            credit_bill_id: creditBillId,
            amount: 30,
          },
        ],
      },
    });

    expect(applied.status).toBe(200);
    expect(applied.body.bill).toEqual(expect.objectContaining({
      id: targetBillId,
      amount: 100,
      amount_paid: 30,
      status: 'UNPAID',
      available_credit_total: 0,
    }));
    expect(applied.body.applications).toEqual([
      expect.objectContaining({
        target_bill_id: targetBillId,
        credit_bill_id: creditBillId,
        amount: 30,
        credit_bill_number: `BILL-CREDIT-SOURCE-${fixture.suffix}`,
      }),
    ]);
    expect(applied.body.transaction).toEqual(expect.objectContaining({
      id: expect.any(Number),
      reference_no: `BILL-CREDIT-TARGET-${fixture.suffix}`,
      fund_id: fixture.fund.id,
      created_by: fixture.userId,
    }));
    createdTransactionIds.push(applied.body.transaction.id as number);

    const storedCredit = await db('bills')
      .where({ id: creditBillId })
      .first() as { amount_paid: string | number; status: string } | undefined;
    expect(storedCredit).toEqual(expect.objectContaining({
      status: 'PAID',
    }));
    expect(Number(storedCredit?.amount_paid)).toBe(-30);

    const transactionIdsBeforeUnapply = await db('transactions')
      .where({
        created_by: fixture.userId,
        fund_id: fixture.fund.id,
      })
      .pluck('id') as number[];

    const unapplied = await requestRoute({
      probePath: `/${targetBillId}/unapply-credits`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });

    const transactionIdsAfterUnapply = await db('transactions')
      .where({
        created_by: fixture.userId,
        fund_id: fixture.fund.id,
      })
      .pluck('id') as number[];
    const unapplyTransactionIds = transactionIdsAfterUnapply
      .filter((id) => !transactionIdsBeforeUnapply.includes(id));
    createdTransactionIds.push(...unapplyTransactionIds);

    expect(unapplied.status).toBe(200);
    expect(unapplied.body).toEqual(expect.objectContaining({
      unapplied_count: 1,
    }));
    expect(unapplied.body.bill).toEqual(expect.objectContaining({
      id: targetBillId,
      amount: 100,
      amount_paid: 0,
      status: 'UNPAID',
      available_credit_total: 30,
    }));

    const storedApplyTransaction = await db('transactions')
      .where({ id: applied.body.transaction.id })
      .first() as { is_voided: boolean } | undefined;
    expect(storedApplyTransaction?.is_voided).toBe(true);
    expect(unapplyTransactionIds).toEqual([]);
  });
});
