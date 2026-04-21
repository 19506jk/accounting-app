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
const createdUserIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdBankTransactionIds: number[] = [];

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
  if (!bankAccount || !incomeAccount || !equityAccount) throw new Error('Failed to create account fixture');
  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

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
    fundId: fund.id,
    suffix,
  };
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

  it('rejects bill_id on create and blocks double-create', async () => {
    const fixture = await createFixture();
    const bankTransactionId = await importBankRow({
      fixture,
      filename: `phase3-create-${fixture.suffix}.csv`,
      description: 'Create row',
      amount: 80,
      bankTransactionId: `PH3-CREATE-${fixture.suffix}`,
      date: '2026-06-05',
    });

    const billRejected = await requestRoute({
      probePath: `/${bankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Create row',
        amount: 80,
        type: 'deposit',
        offset_account_id: fixture.incomeAccountId,
        bill_id: 999,
      },
    });
    expect(billRejected.status).toBe(400);

    const created = await requestRoute({
      probePath: `/${bankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Create row',
        amount: 80,
        type: 'deposit',
        offset_account_id: fixture.incomeAccountId,
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
    if (createdJournalEntryId) {
      const je = await db('journal_entries').where({ id: createdJournalEntryId }).first() as { transaction_id: number } | undefined;
      if (je) createdTransactionIds.push(je.transaction_id);
    }

    const secondCreate = await requestRoute({
      probePath: `/${bankTransactionId}/create`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        date: '2026-06-05',
        description: 'Create row',
        amount: 80,
        type: 'deposit',
        offset_account_id: fixture.incomeAccountId,
      },
    });
    expect(secondCreate.status).toBe(409);
  });
});
