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

let bankTransactionsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');
  const bankTransactionsModule = await import('../bankTransactions.js');
  bankTransactionsRouter = bankTransactionsModule.default as unknown as Router;
});

afterEach(async () => {
  if (createdUploadIds.length > 0) {
    await db('bank_uploads').whereIn('id', createdUploadIds).delete();
    createdUploadIds.length = 0;
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
  method: 'GET' | 'POST' | 'PUT';
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
      google_id: `bank-feed-user-${suffix}`,
      email: `bank-feed-user-${suffix}@example.com`,
      name: `Bank Feed User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create bank feed user fixture');
  createdUserIds.push(user.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `BFT-BANK-${suffix}`,
      name: `Bank Feed Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount) throw new Error('Failed to create bank feed bank account');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `BFT-EQ-${suffix}`,
      name: `Bank Feed Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create bank feed equity account');

  createdAccountIds.push(bankAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Bank Feed Fund ${suffix}`,
      description: 'Bank feed integration fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create bank feed fund');
  createdFundIds.push(fund.id);

  return {
    userId: user.id,
    bankAccountId: bankAccount.id,
    fundId: fund.id,
    suffix,
  };
}

describe('direct DB bank-transactions integration checks', () => {
  it('rejects viewer role for POST /import', async () => {
    const fixture = await createFixture();

    const forbidden = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'viewer',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `forbidden-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-04-01',
            raw_description: 'Viewer Import Attempt',
            amount: -1,
          },
        ],
      },
    });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: 'Access denied — requires role: admin or editor' });
  });

  it('imports rows, flags fingerprint collisions, and returns inline conflicts', async () => {
    const fixture = await createFixture();

    const imported = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `integration-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-04-01',
            raw_description: 'Coffee Shop #123',
            amount: -10.5,
          },
          {
            bank_posted_date: '2026-04-01',
            raw_description: 'Coffee-Shop 123!!!',
            amount: -10.5,
          },
          {
            bank_posted_date: '2026-04-01',
            raw_description: 'Coffee Shop 123',
            amount: -10.5,
          },
        ],
      },
    });

    expect(imported.status).toBe(201);
    createdUploadIds.push(imported.body.upload_id as number);
    expect(imported.body).toEqual({
      upload_id: expect.any(Number),
      inserted: 3,
      skipped: 0,
      needs_review: 2,
      warnings: [],
    });

    const persisted = await db('bank_transactions')
      .where({ upload_id: imported.body.upload_id })
      .orderBy('row_index', 'asc') as Array<{
      id: number;
      row_index: number;
      normalized_description: string;
      fingerprint: string;
      status: string;
      amount: string;
    }>;

    expect(persisted).toHaveLength(3);
    expect(persisted.map((row) => row.status)).toEqual(['imported', 'needs_review', 'needs_review']);
    expect(persisted.map((row) => row.normalized_description)).toEqual([
      'coffee shop 123',
      'coffee shop 123',
      'coffee shop 123',
    ]);
    expect(new Set(persisted.map((row) => row.fingerprint)).size).toBe(1);
    expect(persisted[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    const reviewQueue = await requestRoute({
      probePath: '?status=needs_review',
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(reviewQueue.status).toBe(200);
    expect(reviewQueue.body.items).toHaveLength(2);
    expect(reviewQueue.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        upload_id: imported.body.upload_id,
        status: 'needs_review',
        conflict: expect.objectContaining({
          id: expect.any(Number),
          bank_posted_date: '2026-04-01',
          raw_description: expect.any(String),
          amount: -10.5,
          status: expect.any(String),
        }),
      }),
    ]));
    expect(reviewQueue.body.items[0]).not.toHaveProperty('fingerprint');
  });

  it('imports two same-amount same-date Interac e-transfers as distinct rows when reference numbers differ', async () => {
    const fixture = await createFixture();

    const imported = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `integration-etransfer-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-05-07',
            raw_description: 'INTERAC e-Transfer',
            amount: 100,
            bank_transaction_id: 'REF-001',
            payment_method: 'Interac e-Transfer',
          },
          {
            bank_posted_date: '2026-05-07',
            raw_description: 'INTERAC e-Transfer',
            amount: 100,
            bank_transaction_id: 'REF-002',
            payment_method: 'Interac e-Transfer',
          },
        ],
      },
    });

    expect(imported.status).toBe(201);
    createdUploadIds.push(imported.body.upload_id as number);
    expect(imported.body).toMatchObject({ inserted: 2, skipped: 0, needs_review: 0 });

    const persisted = await db('bank_transactions')
      .where({ upload_id: imported.body.upload_id })
      .orderBy('row_index', 'asc')
      .select('status', 'fingerprint') as Array<{ status: string; fingerprint: string }>;

    expect(persisted.map((row) => row.status)).toEqual(['imported', 'imported']);
    expect(new Set(persisted.map((row) => row.fingerprint)).size).toBe(2);
  });

  it('still flags Interac fingerprint collisions as needs_review when reference numbers are missing', async () => {
    const fixture = await createFixture();

    const imported = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `integration-interac-missing-ref-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-05-07',
            raw_description: 'INTERAC e-Transfer',
            amount: 100,
            payment_method: 'Interac e-Transfer',
          },
          {
            bank_posted_date: '2026-05-07',
            raw_description: 'INTERAC e-Transfer',
            amount: 100,
            payment_method: 'Interac e-Transfer',
          },
        ],
      },
    });

    expect(imported.status).toBe(201);
    createdUploadIds.push(imported.body.upload_id as number);
    expect(imported.body).toMatchObject({ inserted: 2, skipped: 0, needs_review: 1 });
  });

  it('still flags non-Interac fingerprint collisions as needs_review', async () => {
    const fixture = await createFixture();

    const imported = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `integration-noninterac-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-05-07',
            raw_description: 'Coffee Shop',
            amount: -10.5,
          },
          {
            bank_posted_date: '2026-05-07',
            raw_description: 'Coffee Shop',
            amount: -10.5,
          },
        ],
      },
    });

    expect(imported.status).toBe(201);
    createdUploadIds.push(imported.body.upload_id as number);
    expect(imported.body).toMatchObject({ inserted: 2, skipped: 0, needs_review: 1 });
  });

  it('keeps bare E-TRANSFER fingerprinting on the non-Interac path for compatibility', async () => {
    const fixture = await createFixture();

    const imported = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `integration-bare-etransfer-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-05-07',
            raw_description: 'E-TRANSFER Deposit',
            amount: 100,
            bank_transaction_id: `ETRANSFER-A-${fixture.suffix}`,
            payment_method: 'E-TRANSFER',
          },
          {
            bank_posted_date: '2026-05-07',
            raw_description: 'E-TRANSFER Deposit',
            amount: 100,
            bank_transaction_id: `ETRANSFER-B-${fixture.suffix}`,
            payment_method: 'E-TRANSFER',
          },
        ],
      },
    });

    expect(imported.status).toBe(201);
    createdUploadIds.push(imported.body.upload_id as number);
    expect(imported.body).toMatchObject({ inserted: 2, skipped: 0, needs_review: 1 });

    const persisted = await db('bank_transactions')
      .where({ upload_id: imported.body.upload_id })
      .orderBy('row_index', 'asc')
      .select('status', 'fingerprint') as Array<{ status: string; fingerprint: string }>;

    expect(persisted.map((row) => row.status).sort()).toEqual(['imported', 'needs_review']);
    expect(new Set(persisted.map((row) => row.fingerprint)).size).toBe(1);
  });

  it('silently skips rows already imported by bank_transaction_id', async () => {
    const fixture = await createFixture();
    const filename = `dedup-${fixture.suffix}.csv`;

    const first = await requestRoute({
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
            bank_posted_date: '2026-04-02',
            raw_description: 'First Import A',
            amount: 25,
            bank_transaction_id: `FIT-${fixture.suffix}-A`,
          },
          {
            bank_posted_date: '2026-04-02',
            raw_description: 'First Import B',
            amount: -15,
            bank_transaction_id: `FIT-${fixture.suffix}-B`,
          },
        ],
      },
    });
    expect(first.status).toBe(201);
    createdUploadIds.push(first.body.upload_id as number);

    const second = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `dedup-second-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-04-02',
            raw_description: 'Second Import A',
            amount: 25,
            bank_transaction_id: `FIT-${fixture.suffix}-A`,
          },
          {
            bank_posted_date: '2026-04-02',
            raw_description: 'Second Import B',
            amount: -15,
            bank_transaction_id: `FIT-${fixture.suffix}-B`,
          },
        ],
      },
    });

    expect(second.status).toBe(201);
    createdUploadIds.push(second.body.upload_id as number);
    expect(second.body).toEqual({
      upload_id: expect.any(Number),
      inserted: 0,
      skipped: 2,
      needs_review: 0,
      warnings: [],
    });
  });

  it('extracts cheque number from description into bank_transaction_id when field is absent', async () => {
    const fixture = await createFixture();

    const response = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `cheque-extract-${fixture.suffix}.csv`,
        rows: [
          { bank_posted_date: '2026-04-13', raw_description: 'Cheque 640', amount: -54.07 },
          { bank_posted_date: '2026-04-14', raw_description: 'CHEQUE 0001', amount: -100 },
          { bank_posted_date: '2026-04-15', raw_description: 'no number here', amount: -25 },
          {
            bank_posted_date: '2026-04-16',
            raw_description: 'Cheque 999',
            amount: -75,
            bank_transaction_id: 'EXPLICIT-REF',
          },
        ],
      },
    });

    expect(response.status).toBe(201);
    createdUploadIds.push(response.body.upload_id as number);

    const rows = await db('bank_transactions')
      .where({ upload_id: response.body.upload_id })
      .orderBy('row_index', 'asc') as Array<{ bank_transaction_id: string | null }>;

    expect(rows).toHaveLength(4);
    expect(rows[0]?.bank_transaction_id).toBe('640');
    expect(rows[1]?.bank_transaction_id).toBe('0001');
    expect(rows[2]?.bank_transaction_id).toBeNull();
    expect(rows[3]?.bank_transaction_id).toBe('EXPLICIT-REF');
  });

  it('applies review decision once and returns 409 for subsequent reviews', async () => {
    const fixture = await createFixture();

    const imported = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `review-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-04-03',
            raw_description: 'Utility Payment',
            amount: -120,
          },
          {
            bank_posted_date: '2026-04-03',
            raw_description: 'Utility Payment',
            amount: -120,
          },
        ],
      },
    });
    expect(imported.status).toBe(201);
    createdUploadIds.push(imported.body.upload_id as number);
    expect(imported.body.needs_review).toBe(1);

    const queue = await requestRoute({
      probePath: '?status=needs_review&upload_id=' + String(imported.body.upload_id),
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });
    expect(queue.status).toBe(200);
    expect(queue.body.items).toHaveLength(1);

    const needsReviewId = queue.body.items[0].id as number;
    const reviewed = await requestRoute({
      probePath: `/${needsReviewId}/review`,
      method: 'PUT',
      userId: fixture.userId,
      role: 'editor',
      body: {
        decision: 'mark_as_duplicate',
      },
    });

    expect(reviewed.status).toBe(200);
    expect(reviewed.body.item).toEqual(expect.objectContaining({
      id: needsReviewId,
      status: 'archived',
      review_decision: 'mark_as_duplicate',
      reviewed_by: fixture.userId,
      reviewed_at: expect.any(String),
    }));

    const staleReview = await requestRoute({
      probePath: `/${needsReviewId}/review`,
      method: 'PUT',
      userId: fixture.userId,
      role: 'editor',
      body: {
        decision: 'confirmed_new',
      },
    });

    expect(staleReview.status).toBe(409);
    expect(staleReview.body).toEqual({ error: 'Bank transaction already reviewed' });
  });

  it('returns uploads list and single transaction detail', async () => {
    const fixture = await createFixture();

    const imported = await requestRoute({
      probePath: '/import',
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: {
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        filename: `reads-${fixture.suffix}.csv`,
        rows: [
          {
            bank_posted_date: '2026-04-05',
            raw_description: 'Read Path Row',
            amount: 40,
            bank_transaction_id: `READ-${fixture.suffix}`,
            sender_name: '  Jane Doe  ',
            sender_email: '  jane@example.com  ',
            bank_description_2: '  Donation  ',
            payment_method: '  Interac e-Transfer  ',
          },
        ],
      },
    });

    expect(imported.status).toBe(201);
    createdUploadIds.push(imported.body.upload_id as number);

    const uploads = await requestRoute({
      probePath: '/uploads',
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(uploads.status).toBe(200);
    expect(uploads.body.uploads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: imported.body.upload_id,
        account_id: fixture.bankAccountId,
        fund_id: fixture.fundId,
        row_count: 1,
        filename: `reads-${fixture.suffix}.csv`,
      }),
    ]));

    const stored = await db('bank_transactions')
      .where({ upload_id: imported.body.upload_id, row_index: 0 })
      .first() as { id: number } | undefined;
    if (!stored) throw new Error('Expected bank transaction fixture row');

    const detail = await requestRoute({
      probePath: `/${stored.id}`,
      method: 'GET',
      userId: fixture.userId,
      role: 'viewer',
    });

    expect(detail.status).toBe(200);
    expect(detail.body.item).toEqual(expect.objectContaining({
      id: stored.id,
      upload_id: imported.body.upload_id,
      account_id: fixture.bankAccountId,
      fund_id: fixture.fundId,
      bank_posted_date: '2026-04-05',
      raw_description: 'Read Path Row',
      amount: 40,
      status: 'imported',
      sender_name: 'Jane Doe',
      sender_email: 'jane@example.com',
      bank_description_2: 'Donation',
      payment_method: 'Interac e-Transfer',
    }));
    expect(detail.body.item).not.toHaveProperty('fingerprint');
  });
});
