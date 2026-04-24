import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CreateTransactionInput } from '@shared/contracts';
import type { ForensicContext } from '../auditLog.js';

dotenv.config();

const db = require('../../db') as Knex;

let createTransaction: typeof import('../transactions.js').createTransaction;

const createdTransactionIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

beforeAll(async () => {
  await db.raw('select 1');
  const transactionsModule = await import('../transactions.js');
  createTransaction = transactionsModule.createTransaction;
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
      google_id: `audit-log-user-${suffix}`,
      email: `audit-log-user-${suffix}@example.com`,
      name: `Audit Log User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string; email: string; role: string }>;
  if (!user) throw new Error('Failed to create fixture user');
  createdUserIds.push(user.id);

  const [debitAccount] = await db('accounts')
    .insert({
      code: `ALD-${suffix}`,
      name: `Audit Debit ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [creditAccount] = await db('accounts')
    .insert({
      code: `ALC-${suffix}`,
      name: `Audit Credit ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `ALE-${suffix}`,
      name: `Audit Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!debitAccount || !creditAccount || !equityAccount) {
    throw new Error('Failed to create fixture accounts');
  }
  createdAccountIds.push(debitAccount.id, creditAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Audit Fund ${suffix}`,
      description: 'Audit log test fixture fund',
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
    debitAccountId: debitAccount.id,
    creditAccountId: creditAccount.id,
  };
}

function createPayload(fixture: Awaited<ReturnType<typeof createFixture>>, description: string): CreateTransactionInput {
  return {
    date: '2026-04-15',
    description,
    reference_no: `AL-${fixture.suffix}`,
    entries: [
      {
        account_id: fixture.debitAccountId,
        fund_id: fixture.fundId,
        debit: 25,
        credit: 0,
        memo: 'Audit debit leg',
      },
      {
        account_id: fixture.creditAccountId,
        fund_id: fixture.fundId,
        debit: 0,
        credit: 25,
        memo: 'Audit credit leg',
      },
    ],
  };
}

describe('forensic transactional coupling', () => {
  it('writes transaction data and forensic row with matching session_token on success', async () => {
    const fixture = await createFixture();
    const sessionToken = randomUUID();
    const ctx: ForensicContext = {
      sessionToken,
      actor: {
        id: fixture.user.id,
        name: fixture.user.name,
        email: fixture.user.email,
        role: fixture.user.role,
      },
    };

    const description = `Audit create success ${fixture.suffix}`;
    const created = await createTransaction(createPayload(fixture, description), fixture.user.id, ctx);
    createdTransactionIds.push(created.id);

    const auditRow = await db('audit_log')
      .where({ session_token: sessionToken, entity_type: 'transaction', entity_id: String(created.id), action: 'create' })
      .orderBy('id', 'desc')
      .first() as { id: number; session_token: string; payload: unknown } | undefined;

    expect(auditRow).toBeDefined();
    expect(auditRow?.id).toBeTruthy();
    expect(auditRow?.session_token).toBe(sessionToken);

    const payload = typeof auditRow?.payload === 'string'
      ? JSON.parse(auditRow.payload)
      : auditRow?.payload as Record<string, unknown> | undefined;
    expect(payload?.new).toEqual(expect.objectContaining({
      transaction: expect.objectContaining({
        id: created.id,
        description,
      }),
    }));
  });

  it('rolls back domain writes when forensic insert fails', async () => {
    const fixture = await createFixture();
    const description = `Audit rollback ${fixture.suffix}`;
    const payload = createPayload(fixture, description);

    const badCtx = {
      sessionToken: randomUUID(),
      actor: {
        id: fixture.user.id,
        role: fixture.user.role,
      },
    } as unknown as ForensicContext;

    await expect(createTransaction(payload, fixture.user.id, badCtx)).rejects.toBeTruthy();

    const storedTransaction = await db('transactions')
      .where({ description })
      .first() as { id: number } | undefined;
    expect(storedTransaction).toBeUndefined();

    const storedEntries = await db('journal_entries as je')
      .join('transactions as t', 't.id', 'je.transaction_id')
      .where('t.description', description)
      .count<{ count: string }[]>('* as count');
    expect(Number(storedEntries[0]?.count ?? 0)).toBe(0);
  });
});
