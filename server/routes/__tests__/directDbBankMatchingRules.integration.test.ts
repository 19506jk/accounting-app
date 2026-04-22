import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { requestMountedRoute } from '../routeTestHelpers.js';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdUserIds: number[] = [];
const createdAccountIds: number[] = [];
const createdFundIds: number[] = [];
const createdUploadIds: number[] = [];
const createdBankTransactionIds: number[] = [];
const createdRuleIds: number[] = [];

let bankMatchingRulesRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');
  const module = await import('../bankMatchingRules.js');
  bankMatchingRulesRouter = module.default as unknown as Router;
});

afterEach(async () => {
  if (createdBankTransactionIds.length > 0) {
    await db('bank_transaction_events').whereIn('bank_transaction_id', createdBankTransactionIds).delete();
    await db('bank_transactions').whereIn('id', createdBankTransactionIds).delete();
    createdBankTransactionIds.length = 0;
  }
  if (createdUploadIds.length > 0) {
    await db('bank_uploads').whereIn('id', createdUploadIds).delete();
    createdUploadIds.length = 0;
  }
  if (createdRuleIds.length > 0) {
    await db('bank_matching_rule_splits').whereIn('rule_id', createdRuleIds).delete();
    await db('bank_matching_rules').whereIn('id', createdRuleIds).delete();
    createdRuleIds.length = 0;
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
    mountPath: '/api/bank-matching-rules',
    probePath,
    method,
    router: bankMatchingRulesRouter,
    userId,
    role,
    body,
  });
}

async function createFixture() {
  const suffix = uniqueSuffix();
  const [user] = await db('users')
    .insert({
      google_id: `bank-rules-user-${suffix}`,
      email: `bank-rules-user-${suffix}@example.com`,
      name: `Bank Rules User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('failed user fixture');
  createdUserIds.push(user.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `BR-BANK-${suffix}`,
      name: `Bank Rules Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [incomeAccount] = await db('accounts')
    .insert({
      code: `BR-INC-${suffix}`,
      name: `Bank Rules Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `BR-EQ-${suffix}`,
      name: `Bank Rules Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount || !incomeAccount || !equityAccount) throw new Error('failed account fixture');
  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Bank Rules Fund ${suffix}`,
      description: 'Bank rules fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('failed fund fixture');
  createdFundIds.push(fund.id);

  const [upload] = await db('bank_uploads')
    .insert({
      account_id: bankAccount.id,
      fund_id: fund.id,
      uploaded_by: user.id,
      filename: `bank-rules-${suffix}.csv`,
      row_count: 1,
      imported_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!upload) throw new Error('failed upload fixture');
  createdUploadIds.push(upload.id);

  const [row] = await db('bank_transactions')
    .insert({
      upload_id: upload.id,
      row_index: 0,
      bank_transaction_id: `BR-TX-${suffix}`,
      bank_posted_date: '2026-06-20',
      raw_description: 'Sunday Offering Main Campus',
      normalized_description: 'sunday offering main campus',
      amount: '125.00',
      fingerprint: `bank-rules-fingerprint-${suffix}`,
      status: 'imported',
      lifecycle_status: 'open',
      match_status: 'none',
      creation_status: 'none',
      review_status: 'pending',
      imported_at: db.fn.now(),
      last_modified_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!row) throw new Error('failed bank row fixture');
  createdBankTransactionIds.push(row.id);

  return {
    userId: user.id,
    bankAccountId: bankAccount.id,
    incomeAccountId: incomeAccount.id,
    fundId: fund.id,
    bankTransactionId: row.id,
  };
}

describe('direct DB bank matching rules integration checks', () => {
  it('rejects invalid split direction at write time', async () => {
    const fixture = await createFixture();
    const response = await requestRoute({
      probePath: '/',
      method: 'POST',
      userId: fixture.userId,
      body: {
        name: 'Invalid Deposit Split',
        transaction_type: 'deposit',
        match_type: 'contains',
        match_pattern: 'offering',
        splits: [
          {
            percentage: 100,
            fund_id: fixture.fundId,
            expense_account_id: fixture.incomeAccountId,
          },
        ],
      },
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'splits[0].offset_account_id is required for deposit rules',
    });
  });

  it('returns overlap conflicts when simulate draft and active rule both match sampled rows', async () => {
    const fixture = await createFixture();
    const [rule] = await db('bank_matching_rules')
      .insert({
        name: 'Existing Offering Rule',
        priority: 10,
        transaction_type: 'deposit',
        match_type: 'contains',
        match_pattern: 'offering',
        bank_account_id: fixture.bankAccountId,
        offset_account_id: fixture.incomeAccountId,
        is_active: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*') as Array<{ id: number }>;
    if (!rule) throw new Error('failed rule fixture');
    createdRuleIds.push(rule.id);

    const simulated = await requestRoute({
      probePath: '/simulate',
      method: 'POST',
      userId: fixture.userId,
      body: {
        rule: {
          name: 'Draft Offering Rule',
          transaction_type: 'deposit',
          match_type: 'contains',
          match_pattern: 'offering',
          bank_account_id: fixture.bankAccountId,
          offset_account_id: fixture.incomeAccountId,
        },
      },
    });

    expect(simulated.status).toBe(200);
    expect(simulated.body.matches).toHaveLength(1);
    expect(simulated.body.matches[0]).toEqual(expect.objectContaining({
      bank_transaction_id: fixture.bankTransactionId,
      raw_description: 'Sunday Offering Main Campus',
    }));
    expect(simulated.body.conflicts).toEqual([
      expect.objectContaining({
        rule_id: rule.id,
        rule_name: 'Existing Offering Rule',
        reason: 'overlapping_active_rule_match',
        sample_bank_transaction_ids: [fixture.bankTransactionId],
      }),
    ]);
  });
});
