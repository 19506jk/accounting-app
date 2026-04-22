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
      google_id: `bank-rule-engine-user-${suffix}`,
      email: `bank-rule-engine-user-${suffix}@example.com`,
      name: `Bank Rule Engine User ${suffix}`,
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
      code: `BRE-BANK-${suffix}`,
      name: `Bank Rule Engine Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [offsetAccount] = await db('accounts')
    .insert({
      code: `BRE-OFF-${suffix}`,
      name: `Bank Rule Engine Offset ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `BRE-EQ-${suffix}`,
      name: `Bank Rule Engine Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount || !offsetAccount || !equityAccount) throw new Error('failed account fixture');
  createdAccountIds.push(bankAccount.id, offsetAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Bank Rule Engine Fund ${suffix}`,
      description: 'Bank rule engine fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('failed fund fixture');
  createdFundIds.push(fund.id);

  const [rule] = await db('bank_matching_rules')
    .insert({
      name: 'Sunday Offering Rule',
      priority: 5,
      transaction_type: 'deposit',
      match_type: 'contains',
      match_pattern: 'offering',
      bank_account_id: bankAccount.id,
      offset_account_id: offsetAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!rule) throw new Error('failed rule fixture');
  createdRuleIds.push(rule.id);

  const importResponse = await requestRoute({
    probePath: '/import',
    method: 'POST',
    userId: user.id,
    role: 'editor',
    body: {
      account_id: bankAccount.id,
      fund_id: fund.id,
      filename: `bank-rule-engine-${suffix}.csv`,
      rows: [
        {
          bank_posted_date: '2026-06-22',
          raw_description: 'Sunday Offering - Main Service',
          amount: 140,
          bank_transaction_id: `BRE-${suffix}`,
        },
      ],
    },
  });
  if (importResponse.status !== 201) throw new Error('failed import fixture');
  createdUploadIds.push(importResponse.body.upload_id as number);

  const [bankTx] = await db('bank_transactions')
    .where({ upload_id: importResponse.body.upload_id, row_index: 0 })
    .select('id') as Array<{ id: number }>;
  if (!bankTx) throw new Error('failed bank transaction fixture');
  createdBankTransactionIds.push(bankTx.id);

  return {
    userId: user.id,
    bankTransactionId: bankTx.id,
    offsetAccountId: offsetAccount.id,
  };
}

describe('direct DB bank rule-engine integration checks', () => {
  it('stores suggested_create proposal from rule, preserves on hold, and refreshes after release-hold', async () => {
    const fixture = await createFixture();

    const scanned = await requestRoute({
      probePath: `/${fixture.bankTransactionId}/scan`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(scanned.status).toBe(200);
    expect(scanned.body).toEqual(expect.objectContaining({
      bank_transaction_id: fixture.bankTransactionId,
      candidates: [],
      auto_confirmed: null,
    }));

    const suggested = await db('bank_transactions')
      .where({ id: fixture.bankTransactionId })
      .first() as {
      creation_status: string;
      match_status: string;
      create_proposal: string | object | null;
      create_proposal_rule_id: number | null;
      create_proposal_rule_name: string | null;
    } | undefined;
    expect(suggested?.creation_status).toBe('suggested_create');
    expect(suggested?.match_status).toBe('rejected');
    expect(suggested?.create_proposal_rule_id).toEqual(expect.any(Number));
    expect(suggested?.create_proposal_rule_name).toBe('Sunday Offering Rule');
    const proposal = typeof suggested?.create_proposal === 'string'
      ? JSON.parse(suggested.create_proposal)
      : suggested?.create_proposal;
    expect(proposal).toEqual(expect.objectContaining({
      offset_account_id: fixture.offsetAccountId,
    }));

    const held = await requestRoute({
      probePath: `/${fixture.bankTransactionId}/hold`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
      body: { reason_note: 'manual review' },
    });
    expect(held.status).toBe(200);
    expect(held.body.item).toEqual(expect.objectContaining({
      disposition: 'hold',
      creation_status: 'suggested_create',
    }));

    const released = await requestRoute({
      probePath: `/${fixture.bankTransactionId}/release-hold`,
      method: 'POST',
      userId: fixture.userId,
      role: 'editor',
    });
    expect(released.status).toBe(200);
    expect(released.body.item).toEqual(expect.objectContaining({
      disposition: 'none',
      creation_status: 'suggested_create',
      match_status: 'rejected',
    }));

    const events = await db('bank_transaction_events')
      .where({ bank_transaction_id: fixture.bankTransactionId })
      .orderBy('id', 'asc')
      .select('event_type', 'payload') as Array<{ event_type: string; payload: string | null }>;
    expect(events.some((event) => event.event_type === 'create_suggested')).toBe(true);
    expect(events.some((event) => event.event_type === 'hold_released')).toBe(true);
  });
});
