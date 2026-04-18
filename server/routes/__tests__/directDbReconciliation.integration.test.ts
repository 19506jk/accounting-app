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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
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

  const [liabilityAccount] = await db('accounts')
    .insert({
      code: `IRLIAB-${suffix}`,
      name: `Integration Reconciliation Liability ${suffix}`,
      type: 'LIABILITY',
      account_class: 'LIABILITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!liabilityAccount) throw new Error('Failed to create reconciliation fixture liability account');

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

  createdAccountIds.push(bankAccount.id, incomeAccount.id, liabilityAccount.id, equityAccount.id);

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
    incomeAccountId: incomeAccount.id,
    liabilityAccountId: liabilityAccount.id,
    bankEntryId: bankEntry.id,
    fundId: fund.id,
    date,
    suffix,
  };
}

async function createTransactionEntry({
  date,
  description,
  referenceNo,
  fundId,
  createdBy,
  entries,
}: {
  date: string;
  description: string;
  referenceNo: string;
  fundId: number;
  createdBy: number;
  entries: Array<{
    account_id: number;
    fund_id: number;
    debit: string;
    credit: string;
    memo?: string;
  }>;
}) {
  const [transaction] = await db('transactions')
    .insert({
      date,
      description,
      reference_no: referenceNo,
      fund_id: fundId,
      created_by: createdBy,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create reconciliation transaction fixture');
  createdTransactionIds.push(transaction.id);

  const insertedEntries = await db('journal_entries')
    .insert(entries.map((entry) => ({
      ...entry,
      transaction_id: transaction.id,
      is_reconciled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })))
    .returning('*') as Array<{ id: number; account_id: number }>;

  return {
    transactionId: transaction.id,
    entries: insertedEntries,
  };
}

async function createDirectReconciliation({
  accountId,
  statementDate,
  statementBalance,
  openingBalance = '0.00',
  isClosed = false,
  userId,
}: {
  accountId: number;
  statementDate: string;
  statementBalance: string;
  openingBalance?: string;
  isClosed?: boolean;
  userId: number;
}) {
  const [reconciliation] = await db('reconciliations')
    .insert({
      account_id: accountId,
      statement_date: statementDate,
      statement_balance: statementBalance,
      opening_balance: openingBalance,
      is_closed: isClosed,
      created_by: userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!reconciliation) throw new Error('Failed to create reconciliation fixture');
  createdReconciliationIds.push(reconciliation.id);
  return reconciliation.id;
}

async function countReconciliationItems(reconciliationId: number) {
  const row = await db('rec_items')
    .where({ reconciliation_id: reconciliationId })
    .count('id as count')
    .first() as { count: string } | undefined;
  return parseInt(row?.count || '0', 10);
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

  it('updates statement dates by reloading items without duplicating existing rows', async () => {
    const fixture = await createFixture();
    const early = await createTransactionEntry({
      date: '2026-01-05',
      description: `Reconciliation Early ${fixture.suffix}`,
      referenceNo: `IR-EARLY-${fixture.suffix}`,
      fundId: fixture.fundId,
      createdBy: fixture.userId,
      entries: [
        {
          account_id: fixture.bankAccountId,
          fund_id: fixture.fundId,
          debit: '10.00',
          credit: '0.00',
          memo: 'Early bank entry',
        },
        {
          account_id: fixture.incomeAccountId,
          fund_id: fixture.fundId,
          debit: '0.00',
          credit: '10.00',
          memo: 'Early income entry',
        },
      ],
    });
    const late = await createTransactionEntry({
      date: '2026-01-20',
      description: `Reconciliation Late ${fixture.suffix}`,
      referenceNo: `IR-LATE-${fixture.suffix}`,
      fundId: fixture.fundId,
      createdBy: fixture.userId,
      entries: [
        {
          account_id: fixture.bankAccountId,
          fund_id: fixture.fundId,
          debit: '15.00',
          credit: '0.00',
          memo: 'Late bank entry',
        },
        {
          account_id: fixture.incomeAccountId,
          fund_id: fixture.fundId,
          debit: '0.00',
          credit: '15.00',
          memo: 'Late income entry',
        },
      ],
    });

    const created = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.bankAccountId,
        statement_date: '2026-01-10',
        statement_balance: 10,
        opening_balance: 0,
      },
    });
    expect(created.status).toBe(201);
    const reconciliationId = created.body.reconciliation.id as number;
    createdReconciliationIds.push(reconciliationId);
    expect(created.body.items_loaded).toBe(1);
    expect(await countReconciliationItems(reconciliationId)).toBe(1);

    const expanded = await requestRoute({
      probePath: `/${reconciliationId}`,
      method: 'PUT',
      userId: fixture.userId,
      role: 'editor',
      body: {
        statement_date: '2026-01-25',
      },
    });
    expect(expanded.status).toBe(200);
    expect(await countReconciliationItems(reconciliationId)).toBe(2);

    const expandedAgain = await requestRoute({
      probePath: `/${reconciliationId}`,
      method: 'PUT',
      userId: fixture.userId,
      role: 'editor',
      body: {
        statement_date: '2026-01-26',
      },
    });
    expect(expandedAgain.status).toBe(200);
    expect(await countReconciliationItems(reconciliationId)).toBe(2);

    const reduced = await requestRoute({
      probePath: `/${reconciliationId}`,
      method: 'PUT',
      userId: fixture.userId,
      role: 'editor',
      body: {
        statement_date: '2026-01-12',
      },
    });
    expect(reduced.status).toBe(200);

    const items = await db('rec_items as ri')
      .where({ reconciliation_id: reconciliationId })
      .orderBy('journal_entry_id', 'asc')
      .select('journal_entry_id') as Array<{ journal_entry_id: number }>;
    const earlyBankEntry = early.entries.find((entry) => entry.account_id === fixture.bankAccountId);
    const lateBankEntry = late.entries.find((entry) => entry.account_id === fixture.bankAccountId);
    if (!earlyBankEntry || !lateBankEntry) throw new Error('Bank entries not found in fixture');
    expect(items).toEqual([{ journal_entry_id: earlyBankEntry.id }]);
    expect(items).not.toEqual(expect.arrayContaining([{ journal_entry_id: lateBankEntry.id }]));
  });

  it('updates statement balance without reloading items and rejects invalid or closed edits', async () => {
    const fixture = await createFixture();
    await createTransactionEntry({
      date: '2026-01-05',
      description: `Reconciliation Balance Only ${fixture.suffix}`,
      referenceNo: `IR-BAL-${fixture.suffix}`,
      fundId: fixture.fundId,
      createdBy: fixture.userId,
      entries: [
        {
          account_id: fixture.bankAccountId,
          fund_id: fixture.fundId,
          debit: '12.00',
          credit: '0.00',
        },
        {
          account_id: fixture.incomeAccountId,
          fund_id: fixture.fundId,
          debit: '0.00',
          credit: '12.00',
        },
      ],
    });

    const created = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.bankAccountId,
        statement_date: '2026-01-10',
        statement_balance: 12,
        opening_balance: 0,
      },
    });
    expect(created.status).toBe(201);
    const reconciliationId = created.body.reconciliation.id as number;
    createdReconciliationIds.push(reconciliationId);
    expect(await countReconciliationItems(reconciliationId)).toBe(1);

    const balanceOnly = await requestRoute({
      probePath: `/${reconciliationId}`,
      method: 'PUT',
      userId: fixture.userId,
      role: 'editor',
      body: {
        statement_balance: 18,
      },
    });
    expect(balanceOnly.status).toBe(200);
    expect(balanceOnly.body.reconciliation).toEqual(expect.objectContaining({
      id: reconciliationId,
      statement_balance: '18.00',
    }));
    expect(await countReconciliationItems(reconciliationId)).toBe(1);

    const invalidDate = await requestRoute({
      probePath: `/${reconciliationId}`,
      method: 'PUT',
      userId: fixture.userId,
      role: 'editor',
      body: {
        statement_date: '01/31/2026',
      },
    });
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body).toEqual({ error: 'statement_date is not a valid date (YYYY-MM-DD)' });

    const closedId = await createDirectReconciliation({
      accountId: fixture.liabilityAccountId,
      statementDate: '2026-01-31',
      statementBalance: '0.00',
      isClosed: true,
      userId: fixture.userId,
    });
    const closedEdit = await requestRoute({
      probePath: `/${closedId}`,
      method: 'PUT',
      userId: fixture.userId,
      role: 'editor',
      body: {
        statement_balance: 1,
      },
    });
    expect(closedEdit.status).toBe(409);
    expect(closedEdit.body).toEqual({ error: 'Cannot edit a closed reconciliation' });
  });

  it('deletes open reconciliations and rejects deleting closed reconciliations', async () => {
    const fixture = await createFixture();
    const openId = await createDirectReconciliation({
      accountId: fixture.bankAccountId,
      statementDate: '2026-01-31',
      statementBalance: '0.00',
      userId: fixture.userId,
    });

    const deleted = await requestRoute({
      probePath: `/${openId}`,
      method: 'DELETE',
      userId: fixture.userId,
      role: 'admin',
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: 'Reconciliation deleted successfully' });
    createdReconciliationIds.splice(createdReconciliationIds.indexOf(openId), 1);
    await expect(db('reconciliations').where({ id: openId }).first()).resolves.toBeUndefined();

    const closedId = await createDirectReconciliation({
      accountId: fixture.bankAccountId,
      statementDate: '2026-02-28',
      statementBalance: '0.00',
      isClosed: true,
      userId: fixture.userId,
    });
    const rejected = await requestRoute({
      probePath: `/${closedId}`,
      method: 'DELETE',
      userId: fixture.userId,
      role: 'admin',
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({
      error: 'Cannot delete a closed reconciliation — it is part of the audit trail',
    });
  });

  it('rejects invalid POST reconciliation inputs for previous closes, account type, and open conflicts', async () => {
    const fixture = await createFixture();

    const closedId = await createDirectReconciliation({
      accountId: fixture.bankAccountId,
      statementDate: '2026-03-31',
      statementBalance: '100.00',
      isClosed: true,
      userId: fixture.userId,
    });

    const beforeClosed = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.bankAccountId,
        statement_date: '2026-03-15',
        statement_balance: 100,
        opening_balance: 100,
      },
    });
    expect(beforeClosed.status).toBe(400);
    expect(beforeClosed.body).toEqual({
      error: 'Statement date must be after the last closed reconciliation (2026-03-31)',
    });

    const openingMismatch = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.bankAccountId,
        statement_date: '2026-04-30',
        statement_balance: 110,
        opening_balance: 90,
      },
    });
    expect(openingMismatch.status).toBe(400);
    expect(openingMismatch.body).toEqual({
      error: 'Opening balance must equal the previous closing balance of $100.00',
      expected: 100,
    });

    const incomeAccount = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.incomeAccountId,
        statement_date: '2026-01-31',
        statement_balance: 0,
        opening_balance: 0,
      },
    });
    expect(incomeAccount.status).toBe(400);
    expect(incomeAccount.body).toEqual({ error: 'Only ASSET or LIABILITY accounts can be reconciled' });

    await db('reconciliations').where({ id: closedId }).delete();
    createdReconciliationIds.splice(createdReconciliationIds.indexOf(closedId), 1);
    const openId = await createDirectReconciliation({
      accountId: fixture.bankAccountId,
      statementDate: '2026-05-31',
      statementBalance: '110.00',
      userId: fixture.userId,
    });

    const openConflict = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.bankAccountId,
        statement_date: '2026-06-30',
        statement_balance: 120,
        opening_balance: 110,
      },
    });
    expect(openConflict.status).toBe(409);
    expect(openConflict.body.error).toBe(`Account already has an open reconciliation (#${openId}). Close it before starting a new one.`);
  });

  it('handles zero-item reconciliations, liability sign convention, and cleared summaries', async () => {
    const fixture = await createFixture();

    const empty = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.bankAccountId,
        statement_date: '2000-01-01',
        statement_balance: 0,
        opening_balance: 0,
      },
    });
    expect(empty.status).toBe(201);
    const emptyId = empty.body.reconciliation.id as number;
    createdReconciliationIds.push(emptyId);
    expect(empty.body.items_loaded).toBe(0);

    const emptyDetail = await requestRoute({
      probePath: `/${emptyId}`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    expect(emptyDetail.status).toBe(200);
    expect(emptyDetail.body.reconciliation.summary).toEqual({
      total_items: 0,
      cleared_items: 0,
      uncleared_items: 0,
      cleared_debits: 0,
      cleared_credits: 0,
    });

    await createTransactionEntry({
      date: '2026-02-05',
      description: `Liability Reconciliation ${fixture.suffix}`,
      referenceNo: `IR-LIAB-${fixture.suffix}`,
      fundId: fixture.fundId,
      createdBy: fixture.userId,
      entries: [
        {
          account_id: fixture.bankAccountId,
          fund_id: fixture.fundId,
          debit: '50.00',
          credit: '0.00',
          memo: 'Cash received',
        },
        {
          account_id: fixture.liabilityAccountId,
          fund_id: fixture.fundId,
          debit: '0.00',
          credit: '50.00',
          memo: 'Liability credit',
        },
      ],
    });

    const liability = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.liabilityAccountId,
        statement_date: '2026-02-10',
        statement_balance: 50,
        opening_balance: 0,
      },
    });
    expect(liability.status).toBe(201);
    const liabilityId = liability.body.reconciliation.id as number;
    createdReconciliationIds.push(liabilityId);
    expect(liability.body.items_loaded).toBe(1);

    const liabilityDetail = await requestRoute({
      probePath: `/${liabilityId}`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    const liabilityItemId = liabilityDetail.body.reconciliation.items[0].id as number;
    const cleared = await requestRoute({
      probePath: `/${liabilityId}/items/${liabilityItemId}/clear`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual(expect.objectContaining({
      cleared_balance: 50,
      difference: 0,
      status: 'BALANCED',
    }));
  });

  it('returns report data for asset, liability, and empty reconciliations', async () => {
    const fixture = await createFixture();

    await createTransactionEntry({
      date: '2026-02-01',
      description: `Report Asset Cleared ${fixture.suffix}`,
      referenceNo: `IR-RPT-A1-${fixture.suffix}`,
      fundId: fixture.fundId,
      createdBy: fixture.userId,
      entries: [
        {
          account_id: fixture.bankAccountId,
          fund_id: fixture.fundId,
          debit: '20.00',
          credit: '0.00',
          memo: 'Asset cleared in',
        },
        {
          account_id: fixture.incomeAccountId,
          fund_id: fixture.fundId,
          debit: '0.00',
          credit: '20.00',
          memo: 'Asset cleared offset',
        },
      ],
    });

    await createTransactionEntry({
      date: '2026-02-05',
      description: `Report Asset Transit ${fixture.suffix}`,
      referenceNo: `IR-RPT-A2-${fixture.suffix}`,
      fundId: fixture.fundId,
      createdBy: fixture.userId,
      entries: [
        {
          account_id: fixture.bankAccountId,
          fund_id: fixture.fundId,
          debit: '30.00',
          credit: '0.00',
          memo: 'Asset in transit',
        },
        {
          account_id: fixture.incomeAccountId,
          fund_id: fixture.fundId,
          debit: '0.00',
          credit: '30.00',
          memo: 'Asset in transit offset',
        },
      ],
    });

    const assetCreated = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.bankAccountId,
        statement_date: '2026-02-10',
        statement_balance: 20,
        opening_balance: 0,
      },
    });
    expect(assetCreated.status).toBe(201);
    const assetReconciliationId = assetCreated.body.reconciliation.id as number;
    createdReconciliationIds.push(assetReconciliationId);
    expect(assetCreated.body.items_loaded).toBe(2);

    const assetDetail = await requestRoute({
      probePath: `/${assetReconciliationId}`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    const assetClearedItemId = assetDetail.body.reconciliation.items.find((item: { debit: number }) => item.debit === 20)?.id as number;
    const assetCleared = await requestRoute({
      probePath: `/${assetReconciliationId}/items/${assetClearedItemId}/clear`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(assetCleared.status).toBe(200);

    const assetReport = await requestRoute({
      probePath: `/${assetReconciliationId}/report`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    expect(assetReport.status).toBe(200);
    expect(assetReport.body.report).toEqual(expect.objectContaining({
      account_type: 'ASSET',
      is_closed: false,
      status: 'BALANCED',
      opening_balance: 0,
      cleared_in: 20,
      cleared_out: 0,
      statement_ending_balance: 20,
      in_transit: 30,
      outstanding_out: 0,
      adjusted_bank_balance: 50,
      book_balance: 50,
      difference: 0,
    }));
    expect(assetReport.body.report.cleared_in_items).toHaveLength(1);
    expect(assetReport.body.report.in_transit_items).toHaveLength(1);
    expect(assetReport.body.report.fund_activity).toEqual([
      {
        fund_name: expect.any(String),
        net_activity: 50,
      },
    ]);

    await createTransactionEntry({
      date: '2026-03-01',
      description: `Report Liability Cleared ${fixture.suffix}`,
      referenceNo: `IR-RPT-L1-${fixture.suffix}`,
      fundId: fixture.fundId,
      createdBy: fixture.userId,
      entries: [
        {
          account_id: fixture.bankAccountId,
          fund_id: fixture.fundId,
          debit: '40.00',
          credit: '0.00',
          memo: 'Liability cleared offset',
        },
        {
          account_id: fixture.liabilityAccountId,
          fund_id: fixture.fundId,
          debit: '0.00',
          credit: '40.00',
          memo: 'Liability cleared in',
        },
      ],
    });

    await createTransactionEntry({
      date: '2026-03-03',
      description: `Report Liability Transit ${fixture.suffix}`,
      referenceNo: `IR-RPT-L2-${fixture.suffix}`,
      fundId: fixture.fundId,
      createdBy: fixture.userId,
      entries: [
        {
          account_id: fixture.bankAccountId,
          fund_id: fixture.fundId,
          debit: '10.00',
          credit: '0.00',
          memo: 'Liability in transit offset',
        },
        {
          account_id: fixture.liabilityAccountId,
          fund_id: fixture.fundId,
          debit: '0.00',
          credit: '10.00',
          memo: 'Liability in transit',
        },
      ],
    });

    const liabilityCreated = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.liabilityAccountId,
        statement_date: '2026-03-10',
        statement_balance: 40,
        opening_balance: 0,
      },
    });
    expect(liabilityCreated.status).toBe(201);
    const liabilityReconciliationId = liabilityCreated.body.reconciliation.id as number;
    createdReconciliationIds.push(liabilityReconciliationId);
    expect(liabilityCreated.body.items_loaded).toBe(2);

    const liabilityDetail = await requestRoute({
      probePath: `/${liabilityReconciliationId}`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    const liabilityClearedItemId = liabilityDetail.body.reconciliation.items.find((item: { credit: number }) => item.credit === 40)?.id as number;
    const liabilityCleared = await requestRoute({
      probePath: `/${liabilityReconciliationId}/items/${liabilityClearedItemId}/clear`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(liabilityCleared.status).toBe(200);

    const liabilityReport = await requestRoute({
      probePath: `/${liabilityReconciliationId}/report`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    expect(liabilityReport.status).toBe(200);
    expect(liabilityReport.body.report).toEqual(expect.objectContaining({
      account_type: 'LIABILITY',
      is_closed: false,
      status: 'BALANCED',
      opening_balance: 0,
      cleared_in: 40,
      cleared_out: 0,
      statement_ending_balance: 40,
      in_transit: 10,
      outstanding_out: 0,
      adjusted_bank_balance: 50,
      book_balance: 50,
      difference: 0,
    }));
    expect(liabilityReport.body.report.fund_activity).toEqual([
      {
        fund_name: expect.any(String),
        net_activity: 50,
      },
    ]);

    const deletedAsset = await requestRoute({
      probePath: `/${assetReconciliationId}`,
      method: 'DELETE',
      userId: fixture.userId,
      role: 'admin',
    });
    expect(deletedAsset.status).toBe(200);
    createdReconciliationIds.splice(createdReconciliationIds.indexOf(assetReconciliationId), 1);

    const emptyCreated = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        account_id: fixture.bankAccountId,
        statement_date: '2000-01-01',
        statement_balance: 0,
        opening_balance: 0,
      },
    });
    expect(emptyCreated.status).toBe(201);
    expect(emptyCreated.body.items_loaded).toBe(0);
    const emptyReconciliationId = emptyCreated.body.reconciliation.id as number;
    createdReconciliationIds.push(emptyReconciliationId);

    const emptyReport = await requestRoute({
      probePath: `/${emptyReconciliationId}/report`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    expect(emptyReport.status).toBe(200);
    expect(emptyReport.body.report).toEqual(expect.objectContaining({
      opening_balance: 0,
      cleared_in: 0,
      cleared_out: 0,
      in_transit: 0,
      outstanding_out: 0,
      adjusted_bank_balance: 0,
      book_balance: 0,
      difference: 0,
      status: 'BALANCED',
    }));
    expect(emptyReport.body.report.cleared_in_items).toEqual([]);
    expect(emptyReport.body.report.cleared_out_items).toEqual([]);
    expect(emptyReport.body.report.in_transit_items).toEqual([]);
    expect(emptyReport.body.report.outstanding_out_items).toEqual([]);

    const missingReport = await requestRoute({
      probePath: '/999999999/report',
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    expect(missingReport.status).toBe(404);
    expect(missingReport.body).toEqual({ error: 'Reconciliation not found' });
  });
});
