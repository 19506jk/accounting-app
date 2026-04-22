import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { requestMountedRoute } from '../routeTestHelpers.js';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdUploadIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdContactIds: number[] = [];
const createdBillIds: number[] = [];
const createdTaxRateIds: number[] = [];
const createdUserIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdBankTransactionIds: number[] = [];
const accountActiveRestores: Array<{ id: number; is_active: boolean }> = [];

let bankTransactionsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');
  const module = await import('../bankTransactions.js');
  bankTransactionsRouter = module.default as unknown as Router;
});

afterEach(async () => {
  if (createdBankTransactionIds.length > 0) {
    await db('bank_transaction_events').whereIn('bank_transaction_id', createdBankTransactionIds).delete();
    await db('bank_transaction_rejections').whereIn('bank_transaction_id', createdBankTransactionIds).delete();
    await db('reconciliation_reservations').whereIn('bank_transaction_id', createdBankTransactionIds).delete();
    await db('bank_transactions').whereIn('id', createdBankTransactionIds).delete();
    createdBankTransactionIds.length = 0;
  }

  if (createdUploadIds.length > 0) {
    await db('bank_uploads').whereIn('id', createdUploadIds).delete();
    createdUploadIds.length = 0;
  }

  if (createdBillIds.length > 0) {
    await db('bill_line_items').whereIn('bill_id', createdBillIds).delete();
    await db('bills').whereIn('id', createdBillIds).delete();
    createdBillIds.length = 0;
  }

  if (createdTransactionIds.length > 0) {
    await db('transactions').whereIn('id', createdTransactionIds).delete();
    createdTransactionIds.length = 0;
  }

  if (createdTaxRateIds.length > 0) {
    await db('tax_rates').whereIn('id', createdTaxRateIds).delete();
    createdTaxRateIds.length = 0;
  }

  for (const restore of accountActiveRestores) {
    await db('accounts').where({ id: restore.id }).update({ is_active: restore.is_active });
  }
  accountActiveRestores.length = 0;

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

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

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
    mountPath: '/api/bank-transactions',
    probePath,
    method,
    router: bankTransactionsRouter,
    userId,
    role,
    body,
  });
}

async function createFixture() {
  const suffix = uniqueSuffix();
  const [user] = await db('users')
    .insert({
      google_id: `bank-feed-phase3-user-${suffix}`,
      email: `bank-feed-phase3-user-${suffix}@example.com`,
      name: `Bank Feed Phase3 User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create user fixture');
  createdUserIds.push(user.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `BFP3-BANK-${suffix}`,
      name: `Bank Feed Phase3 Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [incomeAccount] = await db('accounts')
    .insert({
      code: `BFP3-INC-${suffix}`,
      name: `Bank Feed Phase3 Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `BFP3-EQ-${suffix}`,
      name: `Bank Feed Phase3 Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [expenseAccount] = await db('accounts')
    .insert({
      code: `BFP3-EXP-${suffix}`,
      name: `Bank Feed Phase3 Expense ${suffix}`,
      type: 'EXPENSE',
      account_class: 'EXPENSE',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [recoverableAccount] = await db('accounts')
    .insert({
      code: `BFP3-REC-${suffix}`,
      name: `Bank Feed Phase3 Recoverable ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount || !incomeAccount || !equityAccount || !expenseAccount || !recoverableAccount) {
    throw new Error('Failed to create account fixture');
  }
  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id, expenseAccount.id, recoverableAccount.id);

  const [payeeContact] = await db('contacts')
    .insert({
      type: 'PAYEE',
      contact_class: 'INDIVIDUAL',
      name: `Bank Feed Phase3 Payee ${suffix}`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!payeeContact) throw new Error('Failed to create contact fixture');
  createdContactIds.push(payeeContact.id);

  const [fund] = await db('funds')
    .insert({
      name: `Bank Feed Phase3 Fund ${suffix}`,
      description: 'Bank feed phase 3 integration fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create fund fixture');
  createdFundIds.push(fund.id);

  return {
    userId: user.id,
    bankAccountId: bankAccount.id,
    incomeAccountId: incomeAccount.id,
    expenseAccountId: expenseAccount.id,
    recoverableAccountId: recoverableAccount.id,
    payeeContactId: payeeContact.id,
    fundId: fund.id,
    suffix,
  };
}

async function ensureAccountByCode({
  code,
  name,
  type,
  accountClass,
}: {
  code: string;
  name: string;
  type: string;
  accountClass: string;
}) {
  const existing = await db('accounts')
    .where({ code })
    .first() as { id: number; is_active: boolean } | undefined;
  if (existing) {
    if (!existing.is_active) {
      accountActiveRestores.push({ id: existing.id, is_active: existing.is_active });
      await db('accounts').where({ id: existing.id }).update({ is_active: true });
    }
    return existing.id;
  }

  const [created] = await db('accounts')
    .insert({
      code,
      name,
      type,
      account_class: accountClass,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!created) throw new Error(`Failed to create account ${code}`);
  createdAccountIds.push(created.id);
  return created.id;
}

async function createUnpaidBill({
  fixture,
  amount,
  status = 'UNPAID',
}: {
  fixture: Awaited<ReturnType<typeof createFixture>>;
  amount: number;
  status?: 'UNPAID' | 'PAID';
}) {
  const [bill] = await db('bills')
    .insert({
      contact_id: fixture.payeeContactId,
      date: '2026-06-01',
      due_date: null,
      bill_number: `BFP3-BILL-${fixture.suffix}-${createdBillIds.length + 1}`,
      description: `Bank Feed Phase3 Bill ${fixture.suffix}`,
      amount: amount.toFixed(2),
      fund_id: fixture.fundId,
      amount_paid: status === 'PAID' ? amount.toFixed(2) : '0.00',
      status,
      created_by: fixture.userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bill) throw new Error('Failed to create bill fixture');
  createdBillIds.push(bill.id);
  return bill.id;
}

async function createTaxRate({
  fixture,
  recoverableAccountId = fixture.recoverableAccountId,
}: {
  fixture: Awaited<ReturnType<typeof createFixture>>;
  recoverableAccountId?: number | null;
}) {
  const [taxRate] = await db('tax_rates')
    .insert({
      name: `BFP3 Tax ${fixture.suffix}-${createdTaxRateIds.length + 1}`,
      rate: '0.1300',
      recoverable_account_id: recoverableAccountId,
      rebate_percentage: '1.0000',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!taxRate) throw new Error('Failed to create tax rate fixture');
  createdTaxRateIds.push(taxRate.id);
  return taxRate.id;
}

async function createCandidateEntry({
  fixture,
  date,
  referenceNo,
  description,
  amount,
}: {
  fixture: Awaited<ReturnType<typeof createFixture>>;
  date: string;
  referenceNo: string;
  description: string;
  amount: number;
}) {
  const [tx] = await db('transactions')
    .insert({
      date,
      description,
      reference_no: referenceNo,
      fund_id: fixture.fundId,
      created_by: fixture.userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!tx) throw new Error('Failed to create transaction fixture');
  createdTransactionIds.push(tx.id);

  const [bankEntry] = await db('journal_entries')
    .insert({
      transaction_id: tx.id,
      account_id: fixture.bankAccountId,
      fund_id: fixture.fundId,
      debit: amount.toFixed(2),
      credit: '0.00',
      memo: `Bank leg ${description}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankEntry) throw new Error('Failed to create bank entry fixture');

  await db('journal_entries').insert({
    transaction_id: tx.id,
    account_id: fixture.incomeAccountId,
    fund_id: fixture.fundId,
    debit: '0.00',
    credit: amount.toFixed(2),
    memo: `Offset leg ${description}`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function importBankRow({
  fixture,
  filename,
  description,
  amount,
  bankTransactionId,
  date,
}: {
  fixture: Awaited<ReturnType<typeof createFixture>>;
  filename: string;
  description: string;
  amount: number;
  bankTransactionId: string;
  date: string;
}) {
  const response = await requestRoute({
    probePath: '/import',
    method: 'POST',
    userId: fixture.userId,
    role: 'editor',
    body: {
      account_id: fixture.bankAccountId,
      fund_id: fixture.fundId,
      filename,
      rows: [
        {
          bank_posted_date: date,
          raw_description: description,
          amount,
          bank_transaction_id: bankTransactionId,
        },
      ],
    },
  });
  if (response.status !== 201) {
    throw new Error(`Import failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  expect(response.status).toBe(201);
  createdUploadIds.push(response.body.upload_id as number);

  const row = await db('bank_transactions')
    .where({ upload_id: response.body.upload_id, row_index: 0 })
    .first() as { id: number } | undefined;
  if (!row) throw new Error('Expected bank transaction row');
  createdBankTransactionIds.push(row.id);
  return row.id;
}

describe('direct DB bank-transactions Phase 3 integration checks', () => {
  it('marks scan as rejected with match_exhausted event when no candidates exist', async () => {
    const fixture = await createFixture();
    const bankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-no-candidates-${fixture.suffix}.csv`,
      description: 'No candidate row',
      amount: 215,
      bankTransactionId: `PH3-NOMATCH-${fixture.suffix}`,
      date: '2026-06-10',
    });

    const scan = await requestRoute({
      probePath: `/${bankTransactionId}/scan`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });

    expect(scan.status).toBe(200);
    expect(scan.body).toEqual(expect.objectContaining({
      bank_transaction_id: bankTransactionId,
      candidates: [],
      auto_confirmed: null,
    }));

    const updated = await db('bank_transactions')
      .where({ id: bankTransactionId })
      .first() as { match_status: string; suggested_match_id: number | null } | undefined;
    expect(updated).toBeDefined();
    expect(updated?.match_status).toBe('rejected');
    expect(updated?.suggested_match_id).toBeNull();

    const event = await db('bank_transaction_events')
      .where({ bank_transaction_id: bankTransactionId, event_type: 'match_exhausted' })
      .first() as { payload: string | null } | undefined;
    expect(event).toBeDefined();
    expect(JSON.parse(String(event?.payload))).toEqual(expect.objectContaining({
      bank_transaction_id: bankTransactionId,
      reason: 'no_candidates',
    }));
  });

  it('blocks hold and ignore on confirmed matches and supports override reset', async () => {
    const fixture = await createFixture();
    await createCandidateEntry({
      fixture,
      date: '2026-06-01',
      referenceNo: `PH3-REF-${fixture.suffix}`,
      description: 'Phase3 Candidate',
      amount: 155,
    });

    const bankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-scan-${fixture.suffix}.csv`,
      description: 'Phase3 Candidate',
      amount: 155,
      bankTransactionId: `PH3-REF-${fixture.suffix}`,
      date: '2026-06-01',
    });

    const scan = await requestRoute({
      probePath: `/${bankTransactionId}/scan`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(scan.status).toBe(200);
    expect(scan.body.auto_confirmed).not.toBeNull();

    const holdBlocked = await requestRoute({
      probePath: `/${bankTransactionId}/hold`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { reason_note: 'manual check' },
    });
    expect(holdBlocked.status).toBe(409);

    const ignoreBlocked = await requestRoute({
      probePath: `/${bankTransactionId}/ignore`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { reason_note: 'manual check' },
    });
    expect(ignoreBlocked.status).toBe(409);

    const override = await requestRoute({
      probePath: `/${bankTransactionId}/override-match`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(override.status).toBe(200);
    expect(override.body.item).toEqual(expect.objectContaining({
      match_status: 'none',
      creation_status: 'none',
      review_status: 'pending',
      matched_journal_entry_id: null,
      status: 'imported',
      journal_entry_id: null,
      reviewed_by: null,
      reviewed_at: null,
      review_decision: null,
      disposition: 'none',
    }));
  });

  it('pays a linked bill on create and blocks double-create', async () => {
    const fixture = await createFixture();
    await ensureAccountByCode({
      code: '20000',
      name: 'Accounts Payable',
      type: 'LIABILITY',
      accountClass: 'LIABILITY',
    });
    const billId = await createUnpaidBill({ fixture, amount: 80 });
    const bankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-create-${fixture.suffix}.csv`,
      description: 'Bill payment row',
      amount: -80,
      bankTransactionId: `PH3-CREATE-${fixture.suffix}`,
      date: '2026-06-05',
    });

    const created = await requestRoute({
      probePath: `/${bankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Bill payment row',
        amount: 80,
        type: 'withdrawal',
        bill_id: billId,
      },
    });
    expect(created.status).toBe(200);
    expect(created.body.item).toEqual(expect.objectContaining({
      creation_status: 'created',
      review_status: 'reviewed',
      status: 'created_new',
    }));

    const createdJournalEntryId = created.body.item?.journal_entry_id as number | null | undefined;
    expect(typeof createdJournalEntryId).toBe('number');
    let paymentTransactionId: number | null = null;
    if (createdJournalEntryId) {
      const je = await db('journal_entries').where({ id: createdJournalEntryId }).first() as { transaction_id: number } | undefined;
      expect(je).toEqual(expect.objectContaining({
        transaction_id: expect.any(Number),
      }));
      if (je) {
        paymentTransactionId = je.transaction_id;
        createdTransactionIds.push(je.transaction_id);
      }
    }

    const paidBill = await db('bills').where({ id: billId }).first() as {
      status: string;
      amount_paid: string | number;
      transaction_id: number | null;
    } | undefined;
    expect(paidBill).toEqual(expect.objectContaining({
      status: 'PAID',
      transaction_id: paymentTransactionId,
    }));
    expect(Number(paidBill?.amount_paid)).toBe(80);

    const secondCreate = await requestRoute({
      probePath: `/${bankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Bill payment row',
        amount: 80,
        type: 'withdrawal',
        bill_id: billId,
      },
    });
    expect(secondCreate.status).toBe(409);
  });

  it('rejects invalid bill-link create combinations', async () => {
    const fixture = await createFixture();
    await ensureAccountByCode({
      code: '20000',
      name: 'Accounts Payable',
      type: 'LIABILITY',
      accountClass: 'LIABILITY',
    });
    const billId = await createUnpaidBill({ fixture, amount: 80 });
    const paidBillId = await createUnpaidBill({ fixture, amount: 80, status: 'PAID' });

    const depositBankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-bill-deposit-${fixture.suffix}.csv`,
      description: 'Deposit bill row',
      amount: 80,
      bankTransactionId: `PH3-BILL-DEP-${fixture.suffix}`,
      date: '2026-06-05',
    });
    const withdrawalBankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-bill-withdrawal-${fixture.suffix}.csv`,
      description: 'Withdrawal bill row',
      amount: -80,
      bankTransactionId: `PH3-BILL-WD-${fixture.suffix}`,
      date: '2026-06-05',
    });

    const depositLinked = await requestRoute({
      probePath: `/${depositBankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Deposit bill row',
        amount: 80,
        type: 'deposit',
        bill_id: billId,
      },
    });
    expect(depositLinked.status).toBe(400);

    const splitLinked = await requestRoute({
      probePath: `/${withdrawalBankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Withdrawal bill row',
        amount: 80,
        type: 'withdrawal',
        bill_id: billId,
        payee_id: fixture.payeeContactId,
        splits: [{
          amount: 80,
          fund_id: fixture.fundId,
          expense_account_id: fixture.expenseAccountId,
          pre_tax_amount: 80,
          rounding_adjustment: 0,
        }],
      },
    });
    expect(splitLinked.status).toBe(400);

    const offsetLinked = await requestRoute({
      probePath: `/${withdrawalBankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Withdrawal bill row',
        amount: 80,
        type: 'withdrawal',
        bill_id: billId,
        offset_account_id: fixture.incomeAccountId,
      },
    });
    expect(offsetLinked.status).toBe(400);

    const wrongAmount = await requestRoute({
      probePath: `/${withdrawalBankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Withdrawal bill row',
        amount: 79,
        type: 'withdrawal',
        bill_id: billId,
      },
    });
    expect(wrongAmount.status).toBe(400);

    const alreadyPaid = await requestRoute({
      probePath: `/${withdrawalBankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Withdrawal bill row',
        amount: 80,
        type: 'withdrawal',
        bill_id: paidBillId,
      },
    });
    expect(alreadyPaid.status).toBe(400);
  });

  it('posts recoverable tax and rounding lines for bank-feed withdrawal splits', async () => {
    const fixture = await createFixture();
    const roundingAccountId = await ensureAccountByCode({
      code: '59999',
      name: 'Rounding Adjustments',
      type: 'EXPENSE',
      accountClass: 'EXPENSE',
    });
    const taxRateId = await createTaxRate({ fixture });
    const bankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-tax-split-${fixture.suffix}.csv`,
      description: 'Taxed withdrawal row',
      amount: -11.31,
      bankTransactionId: `PH3-TAX-${fixture.suffix}`,
      date: '2026-06-07',
    });

    const created = await requestRoute({
      probePath: `/${bankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-07',
        description: 'Taxed withdrawal row',
        amount: 11.31,
        type: 'withdrawal',
        payee_id: fixture.payeeContactId,
        splits: [{
          amount: 11.31,
          fund_id: fixture.fundId,
          expense_account_id: fixture.expenseAccountId,
          tax_rate_id: taxRateId,
          pre_tax_amount: 10,
          rounding_adjustment: 0.01,
          description: 'Taxed split',
        }],
      },
    });
    expect(created.status).toBe(200);

    const bankJournalEntryId = created.body.item?.journal_entry_id as number;
    const bankEntry = await db('journal_entries').where({ id: bankJournalEntryId }).first() as { transaction_id: number } | undefined;
    expect(bankEntry).toBeDefined();
    if (!bankEntry) throw new Error('Expected bank journal entry');
    createdTransactionIds.push(bankEntry.transaction_id);

    const entries = await db('journal_entries')
      .where({ transaction_id: bankEntry.transaction_id })
      .select('account_id', 'debit', 'credit', 'tax_rate_id')
      .orderBy('id', 'asc') as Array<{ account_id: number; debit: string | number; credit: string | number; tax_rate_id: number | null }>;

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_id: fixture.bankAccountId, debit: '0.00', credit: '11.31' }),
      expect.objectContaining({ account_id: fixture.expenseAccountId, debit: '10.00', credit: '0.00', tax_rate_id: taxRateId }),
      expect.objectContaining({ account_id: fixture.recoverableAccountId, debit: '1.30', credit: '0.00' }),
      expect.objectContaining({ account_id: roundingAccountId, debit: '0.01', credit: '0.00' }),
    ]));
  });

  it('rejects withdrawal split tax rates without recoverable accounts', async () => {
    const fixture = await createFixture();
    const taxRateId = await createTaxRate({ fixture, recoverableAccountId: null });
    const bankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-tax-missing-recoverable-${fixture.suffix}.csv`,
      description: 'Missing recoverable row',
      amount: -11.30,
      bankTransactionId: `PH3-MISS-REC-${fixture.suffix}`,
      date: '2026-06-07',
    });

    const rejected = await requestRoute({
      probePath: `/${bankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-07',
        description: 'Missing recoverable row',
        amount: 11.30,
        type: 'withdrawal',
        payee_id: fixture.payeeContactId,
        splits: [{
          amount: 11.30,
          fund_id: fixture.fundId,
          expense_account_id: fixture.expenseAccountId,
          tax_rate_id: taxRateId,
          pre_tax_amount: 10,
          rounding_adjustment: 0,
        }],
      },
    });
    expect(rejected.status).toBe(400);
  });

  it('rejects withdrawal split rounding when the rounding account is unavailable', async () => {
    const fixture = await createFixture();
    const activeRoundingAccounts = await db('accounts')
      .where({ code: '59999', is_active: true })
      .select('id', 'is_active') as Array<{ id: number; is_active: boolean }>;
    activeRoundingAccounts.forEach((account) => {
      accountActiveRestores.push({ id: account.id, is_active: account.is_active });
    });
    if (activeRoundingAccounts.length > 0) {
      await db('accounts')
        .whereIn('id', activeRoundingAccounts.map((account) => account.id))
        .update({ is_active: false });
    }

    const bankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-rounding-missing-${fixture.suffix}.csv`,
      description: 'Missing rounding row',
      amount: -10.01,
      bankTransactionId: `PH3-MISS-ROUND-${fixture.suffix}`,
      date: '2026-06-07',
    });

    const rejected = await requestRoute({
      probePath: `/${bankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-07',
        description: 'Missing rounding row',
        amount: 10.01,
        type: 'withdrawal',
        payee_id: fixture.payeeContactId,
        splits: [{
          amount: 10.01,
          fund_id: fixture.fundId,
          expense_account_id: fixture.expenseAccountId,
          pre_tax_amount: 10,
          rounding_adjustment: 0.01,
        }],
      },
    });
    expect(rejected.status).toBe(400);
  });
});
