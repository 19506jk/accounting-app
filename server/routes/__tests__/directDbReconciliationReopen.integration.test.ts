import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { requestMountedRoute } from '../routeTestHelpers.js';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdReconciliationIds: number[] = [];
const createdUploadIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdBankTransactionIds: number[] = [];

let reconciliationRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');
  const module = await import('../reconciliation.js');
  reconciliationRouter = module.default as unknown as Router;
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

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function requestRoute({
  probePath,
  method,
  userId,
  role = 'admin',
}: {
  probePath: string;
  method: 'POST';
  userId: number;
  role?: 'admin' | 'editor' | 'viewer';
}) {
  return requestMountedRoute({
    mountPath: '/api/reconciliations',
    probePath,
    method,
    router: reconciliationRouter,
    userId,
    role,
  });
}

async function createFixture() {
  const suffix = uniqueSuffix();
  const [user] = await db('users')
    .insert({
      google_id: `reopen-phase2-user-${suffix}`,
      email: `reopen-phase2-user-${suffix}@example.com`,
      name: `Reopen User ${suffix}`,
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
      code: `ROP2-BANK-${suffix}`,
      name: `Reopen Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [incomeAccount] = await db('accounts')
    .insert({
      code: `ROP2-INC-${suffix}`,
      name: `Reopen Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `ROP2-EQ-${suffix}`,
      name: `Reopen Equity ${suffix}`,
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
      name: `Reopen Fund ${suffix}`,
      description: 'Reopen test fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create fund fixture');
  createdFundIds.push(fund.id);

  const [tx] = await db('transactions')
    .insert({
      date: '2026-06-01',
      description: `Reopen Source Tx ${suffix}`,
      reference_no: `REOPEN-${suffix}`,
      fund_id: fund.id,
      created_by: user.id,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!tx) throw new Error('Failed to create source transaction');
  createdTransactionIds.push(tx.id);

  const [bankEntry] = await db('journal_entries')
    .insert({
      transaction_id: tx.id,
      account_id: bankAccount.id,
      fund_id: fund.id,
      debit: '50.00',
      credit: '0.00',
      memo: 'Reopen bank leg',
      is_reconciled: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  await db('journal_entries').insert({
    transaction_id: tx.id,
    account_id: incomeAccount.id,
    fund_id: fund.id,
    debit: '0.00',
    credit: '50.00',
    memo: 'Reopen offset leg',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  if (!bankEntry) throw new Error('Failed to create bank entry');

  const [reconciliation] = await db('reconciliations')
    .insert({
      account_id: bankAccount.id,
      statement_date: '2026-06-30',
      statement_balance: '50.00',
      opening_balance: '0.00',
      is_closed: true,
      created_by: user.id,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!reconciliation) throw new Error('Failed to create reconciliation');
  createdReconciliationIds.push(reconciliation.id);

  await db('rec_items').insert({
    reconciliation_id: reconciliation.id,
    journal_entry_id: bankEntry.id,
    is_cleared: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const [upload] = await db('bank_uploads')
    .insert({
      account_id: bankAccount.id,
      fund_id: fund.id,
      uploaded_by: user.id,
      filename: `reopen-${suffix}.csv`,
      row_count: 1,
      imported_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!upload) throw new Error('Failed to create bank upload');
  createdUploadIds.push(upload.id);

  return {
    userId: user.id,
    reconciliationId: reconciliation.id,
    bankEntryId: bankEntry.id,
    uploadId: upload.id,
  };
}

async function insertMatchedBankTransaction({
  uploadId,
  bankEntryId,
  lifecycleStatus,
}: {
  uploadId: number;
  bankEntryId: number;
  lifecycleStatus: 'open' | 'locked';
}) {
  const [bankTransaction] = await db('bank_transactions')
    .insert({
      upload_id: uploadId,
      row_index: Math.floor(Math.random() * 100000),
      bank_transaction_id: `REOPEN-MATCH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      bank_posted_date: '2026-06-01',
      bank_effective_date: null,
      raw_description: 'Reopen matched row',
      normalized_description: 'reopen matched row',
      amount: '50.00',
      fingerprint: 'a'.repeat(64),
      status: 'matched_existing',
      journal_entry_id: bankEntryId,
      imported_at: db.fn.now(),
      last_modified_at: db.fn.now(),
      lifecycle_status: lifecycleStatus,
      match_status: 'confirmed',
      creation_status: 'none',
      review_status: lifecycleStatus === 'open' ? 'reviewed' : 'pending',
      match_source: 'human',
      creation_source: null,
      suggested_match_id: null,
      matched_journal_entry_id: bankEntryId,
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankTransaction) throw new Error('Failed to create matched bank transaction');
  createdBankTransactionIds.push(bankTransaction.id);
  return bankTransaction.id;
}

describe('direct DB reconciliation reopen integration checks', () => {
  it('locks matching open confirmed bank transactions when reconciliation closes', async () => {
    const fixture = await createFixture();
    const bankTransactionId = await insertMatchedBankTransaction({
      uploadId: fixture.uploadId,
      bankEntryId: fixture.bankEntryId,
      lifecycleStatus: 'open',
    });

    await db('reconciliations')
      .where({ id: fixture.reconciliationId })
      .update({ is_closed: false, updated_at: db.fn.now() });
    await db('journal_entries')
      .where({ id: fixture.bankEntryId })
      .update({ is_reconciled: false, updated_at: db.fn.now() });

    const closeResponse = await requestRoute({
      probePath: `/${fixture.reconciliationId}/close`,
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
    });
    expect(closeResponse.status).toBe(200);

    const updatedBankTransaction = await db('bank_transactions')
      .where({ id: bankTransactionId })
      .first() as { lifecycle_status: string } | undefined;
    expect(updatedBankTransaction?.lifecycle_status).toBe('locked');
  });

  it('blocks reopen when an open confirmed bank claim exists', async () => {
    const fixture = await createFixture();
    const bankTransactionId = await insertMatchedBankTransaction({
      uploadId: fixture.uploadId,
      bankEntryId: fixture.bankEntryId,
      lifecycleStatus: 'open',
    });

    const response = await requestRoute({
      probePath: `/${fixture.reconciliationId}/reopen`,
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Reopen blocked by active bank match claims');
    expect(response.body.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: bankTransactionId,
        matched_journal_entry_id: fixture.bankEntryId,
      }),
    ]));
  });

  it('allows reopen with locked confirmed matches and unlocks them', async () => {
    const fixture = await createFixture();
    const bankTransactionId = await insertMatchedBankTransaction({
      uploadId: fixture.uploadId,
      bankEntryId: fixture.bankEntryId,
      lifecycleStatus: 'locked',
    });

    const response = await requestRoute({
      probePath: `/${fixture.reconciliationId}/reopen`,
      method: 'POST',
      userId: fixture.userId,
      role: 'admin',
    });

    expect(response.status).toBe(200);
    expect(response.body.reconciliation).toEqual(expect.objectContaining({
      id: fixture.reconciliationId,
      is_closed: false,
    }));

    const reopenedEntry = await db('journal_entries')
      .where({ id: fixture.bankEntryId })
      .first() as { is_reconciled: boolean } | undefined;
    expect(reopenedEntry?.is_reconciled).toBe(false);

    const updatedBankTransaction = await db('bank_transactions')
      .where({ id: bankTransactionId })
      .first() as { lifecycle_status: string } | undefined;
    expect(updatedBankTransaction?.lifecycle_status).toBe('open');
  });
});
