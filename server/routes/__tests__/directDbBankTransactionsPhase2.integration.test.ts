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
      google_id: `bank-feed-phase2-user-${suffix}`,
      email: `bank-feed-phase2-user-${suffix}@example.com`,
      name: `Bank Feed Phase2 User ${suffix}`,
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
      code: `BFP2-BANK-${suffix}`,
      name: `Bank Feed Phase2 Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [incomeAccount] = await db('accounts')
    .insert({
      code: `BFP2-INC-${suffix}`,
      name: `Bank Feed Phase2 Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `BFP2-EQ-${suffix}`,
      name: `Bank Feed Phase2 Equity ${suffix}`,
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
      name: `Bank Feed Phase2 Fund ${suffix}`,
      description: 'Bank feed phase 2 integration fixture fund',
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

  if (!bankEntry) throw new Error('Failed to create bank journal entry fixture');
  return bankEntry.id;
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

describe('direct DB bank-transactions Phase 2 integration checks', () => {
  it('supports idempotent reserve and writes release+acquire events when switching candidates', async () => {
    const fixture = await createFixture();
    const firstCandidate = await createCandidateEntry({
      fixture,
      date: '2026-05-10',
      referenceNo: `SWITCH-A-${fixture.suffix}`,
      description: 'Switch Candidate A',
      amount: 100,
    });
    const secondCandidate = await createCandidateEntry({
      fixture,
      date: '2026-05-10',
      referenceNo: `SWITCH-B-${fixture.suffix}`,
      description: 'Switch Candidate B',
      amount: 100,
    });

    const bankTransactionId = await importBankRow({
      fixture,
      filename: `switch-${fixture.suffix}.csv`,
      description: 'Switch Import Row',
      amount: 100,
      bankTransactionId: `SWITCH-ROW-${fixture.suffix}`,
      date: '2026-05-10',
    });

    const scanned = await requestRoute({
      probePath: `/${bankTransactionId}/scan`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(scanned.status).toBe(200);
    expect(scanned.body.candidates).toHaveLength(2);

    const reserveFirst = await requestRoute({
      probePath: `/${bankTransactionId}/reserve`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { journal_entry_id: firstCandidate },
    });
    expect(reserveFirst.status).toBe(200);

    const reserveFirstAgain = await requestRoute({
      probePath: `/${bankTransactionId}/reserve`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { journal_entry_id: firstCandidate },
    });
    expect(reserveFirstAgain.status).toBe(200);

    const reserveSecond = await requestRoute({
      probePath: `/${bankTransactionId}/reserve`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { journal_entry_id: secondCandidate },
    });
    expect(reserveSecond.status).toBe(200);

    const reservation = await db('reconciliation_reservations')
      .where({ bank_transaction_id: bankTransactionId })
      .first() as { journal_entry_id: number } | undefined;
    expect(reservation?.journal_entry_id).toBe(secondCandidate);

    const events = await db('bank_transaction_events')
      .where({ bank_transaction_id: bankTransactionId })
      .orderBy('id', 'asc')
      .select('event_type', 'payload') as Array<{ event_type: string; payload: string | null }>;
    const releaseEvent = events.find((event) => event.event_type === 'reservation_released');
    expect(releaseEvent).toBeDefined();
    expect(JSON.parse(String(releaseEvent?.payload)).journal_entry_id).toBe(firstCandidate);
    expect(events.filter((event) => event.event_type === 'reservation_acquired').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps self-reserved candidate visible on re-scan', async () => {
    const fixture = await createFixture();
    const candidate = await createCandidateEntry({
      fixture,
      date: '2026-05-12',
      referenceNo: `RESCAN-${fixture.suffix}`,
      description: 'Rescan Candidate',
      amount: 120,
    });

    const bankTransactionId = await importBankRow({
      fixture,
      filename: `rescan-${fixture.suffix}.csv`,
      description: 'Rescan Import Row',
      amount: 120,
      bankTransactionId: `RESCAN-ROW-${fixture.suffix}`,
      date: '2026-05-12',
    });

    const firstScan = await requestRoute({
      probePath: `/${bankTransactionId}/scan`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(firstScan.status).toBe(200);

    const reserved = await requestRoute({
      probePath: `/${bankTransactionId}/reserve`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { journal_entry_id: candidate },
    });
    expect(reserved.status).toBe(200);

    const rescan = await requestRoute({
      probePath: `/${bankTransactionId}/scan`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(rescan.status).toBe(200);
    expect((rescan.body.candidates as Array<{ journal_entry_id: number }>).map((row) => row.journal_entry_id))
      .toContain(candidate);
  });

  it('excludes already-confirmed journal entry claims when scanning another bank row', async () => {
    const fixture = await createFixture();
    const candidate = await createCandidateEntry({
      fixture,
      date: '2026-05-20',
      referenceNo: `CONFIRM-${fixture.suffix}`,
      description: 'Confirm Candidate',
      amount: 90,
    });

    const firstBankTransaction = await importBankRow({
      fixture,
      filename: `confirm-first-${fixture.suffix}.csv`,
      description: 'Confirm First Import',
      amount: 90,
      bankTransactionId: `CONFIRM-FIRST-${fixture.suffix}`,
      date: '2026-05-18',
    });
    const secondBankTransaction = await importBankRow({
      fixture,
      filename: `confirm-second-${fixture.suffix}.csv`,
      description: 'Confirm Second Import',
      amount: 90,
      bankTransactionId: `CONFIRM-SECOND-${fixture.suffix}`,
      date: '2026-05-18',
    });

    const firstScan = await requestRoute({
      probePath: `/${firstBankTransaction}/scan`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(firstScan.status).toBe(200);

    const reserved = await requestRoute({
      probePath: `/${firstBankTransaction}/reserve`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { journal_entry_id: candidate },
    });
    expect(reserved.status).toBe(200);

    const confirmed = await requestRoute({
      probePath: `/${firstBankTransaction}/confirm`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { journal_entry_id: candidate },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.item).toEqual(expect.objectContaining({
      status: 'matched_existing',
      match_status: 'confirmed',
      journal_entry_id: candidate,
      matched_journal_entry_id: candidate,
    }));

    const rejectConfirmed = await requestRoute({
      probePath: `/${firstBankTransaction}/reject`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { journal_entry_id: candidate },
    });
    expect(rejectConfirmed.status).toBe(409);
    expect(rejectConfirmed.body).toEqual({ error: 'Cannot reject a confirmed match' });

    const secondScan = await requestRoute({
      probePath: `/${secondBankTransaction}/scan`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(secondScan.status).toBe(200);
    expect((secondScan.body.candidates as Array<{ journal_entry_id: number }>).map((row) => row.journal_entry_id))
      .not.toContain(candidate);
  });
});
