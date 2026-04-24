import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CreateTransactionInput } from '@shared/contracts';
import type { ForensicContext } from '../auditLog.js';

dotenv.config();

const db = require('../../db') as Knex;

let createTransaction: typeof import('../transactions.js').createTransaction;
let updateTransaction: typeof import('../transactions.js').updateTransaction;

const createdTransactionIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

beforeAll(async () => {
  await db.raw('select 1');
  const transactionsModule = await import('../transactions.js');
  createTransaction = transactionsModule.createTransaction;
  updateTransaction = transactionsModule.updateTransaction;
});

afterEach(async () => {
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
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function createFixture() {
  const suffix = uniqueSuffix();

  const [user] = await db('users')
    .insert({
      google_id: `txn-forensic-user-${suffix}`,
      email: `txn-forensic-user-${suffix}@example.com`,
      name: `Txn Forensic User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string; email: string; role: string }>;
  if (!user) throw new Error('Failed to create fixture user');
  createdUserIds.push(user.id);

  const [assetAccount] = await db('accounts')
    .insert({
      code: `TFA-${suffix}`,
      name: `Txn Forensic Asset ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [expenseAccount] = await db('accounts')
    .insert({
      code: `TFE-${suffix}`,
      name: `Txn Forensic Expense ${suffix}`,
      type: 'EXPENSE',
      account_class: 'EXPENSE',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [incomeAccount] = await db('accounts')
    .insert({
      code: `TFI-${suffix}`,
      name: `Txn Forensic Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `TFQ-${suffix}`,
      name: `Txn Forensic Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!assetAccount || !expenseAccount || !incomeAccount || !equityAccount) {
    throw new Error('Failed to create fixture accounts');
  }
  createdAccountIds.push(assetAccount.id, expenseAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Txn Forensic Fund ${suffix}`,
      description: 'Transaction forensic fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create fixture fund');
  createdFundIds.push(fund.id);

  return {
    suffix,
    user,
    fundId: fund.id,
    assetAccountId: assetAccount.id,
    expenseAccountId: expenseAccount.id,
    incomeAccountId: incomeAccount.id,
  };
}

function makeCreatePayload(fixture: Awaited<ReturnType<typeof createFixture>>): CreateTransactionInput {
  return {
    date: '2026-04-18',
    description: `Txn forensic before ${fixture.suffix}`,
    reference_no: `TF-${fixture.suffix}`,
    entries: [
      {
        account_id: fixture.assetAccountId,
        fund_id: fixture.fundId,
        debit: 70,
        credit: 0,
        memo: 'Asset leg',
      },
      {
        account_id: fixture.expenseAccountId,
        fund_id: fixture.fundId,
        debit: 30,
        credit: 0,
        memo: 'Expense leg',
      },
      {
        account_id: fixture.incomeAccountId,
        fund_id: fixture.fundId,
        debit: 0,
        credit: 100,
        memo: 'Income leg',
      },
    ],
  };
}

describe('transaction forensic snapshots', () => {
  it('captures full old/new aggregate entry snapshots on update', async () => {
    const fixture = await createFixture();
    const createCtx: ForensicContext = {
      sessionToken: randomUUID(),
      actor: {
        id: fixture.user.id,
        name: fixture.user.name,
        email: fixture.user.email,
        role: fixture.user.role,
      },
    };

    const created = await createTransaction(makeCreatePayload(fixture), fixture.user.id, createCtx);
    createdTransactionIds.push(created.id);

    const beforeEntries = await db('journal_entries')
      .where({ transaction_id: created.id })
      .orderBy('id', 'asc')
      .select('id', 'account_id', 'fund_id', 'debit', 'credit', 'memo', 'contact_id') as Array<{
        id: number;
        account_id: number;
        fund_id: number;
        debit: string;
        credit: string;
        memo: string | null;
        contact_id: number | null;
      }>;
    expect(beforeEntries).toHaveLength(3);

    const updatedDescription = `Txn forensic after ${fixture.suffix}`;
    const updateCtx: ForensicContext = {
      sessionToken: randomUUID(),
      actor: {
        id: fixture.user.id,
        name: fixture.user.name,
        email: fixture.user.email,
        role: fixture.user.role,
      },
    };

    await updateTransaction(String(created.id), { description: updatedDescription }, updateCtx);

    const auditRow = await db('audit_log')
      .where({
        session_token: updateCtx.sessionToken,
        entity_type: 'transaction',
        entity_id: String(created.id),
        action: 'update',
      })
      .orderBy('id', 'desc')
      .first() as { payload: unknown } | undefined;
    expect(auditRow).toBeDefined();

    const payload = typeof auditRow?.payload === 'string'
      ? JSON.parse(auditRow.payload)
      : auditRow?.payload as Record<string, unknown> | undefined;
    const oldEntries = payload?.old && typeof payload.old === 'object'
      ? (payload.old as { entries?: unknown }).entries as unknown[] | undefined
      : undefined;

    expect(oldEntries).toHaveLength(3);
    expect(oldEntries).toEqual(beforeEntries.map((entry) => ({
      id: entry.id,
      account_id: entry.account_id,
      fund_id: entry.fund_id,
      debit: entry.debit,
      credit: entry.credit,
      memo: entry.memo,
      contact_id: entry.contact_id,
    })));

    const fieldsChanged = payload?.fields_changed as Record<string, { from: unknown; to: unknown }> | undefined;
    expect(fieldsChanged?.description).toEqual({
      from: `Txn forensic before ${fixture.suffix}`,
      to: updatedDescription,
    });
  });
});
