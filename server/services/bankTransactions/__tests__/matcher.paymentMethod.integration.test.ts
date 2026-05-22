import dotenv from 'dotenv';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

dotenv.config();

const db = require('../../../db') as Knex;

let runMatcher: (typeof import('../matcher.js'))['runMatcher'];

const createdUploadIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdAccountIds: number[] = [];
const createdFundIds: number[] = [];
const createdUserIds: number[] = [];

beforeAll(async () => {
  await db.raw('select 1');
  const mod = await import('../matcher.js');
  runMatcher = mod.runMatcher;
});

afterEach(async () => {
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
  return `${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

async function createFixture() {
  const suffix = uniqueSuffix();

  const [user] = await db('users')
    .insert({
      google_id: `matcher-pm-${suffix}`,
      email: `matcher-pm-${suffix}@example.com`,
      name: `Matcher PM ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create user');
  createdUserIds.push(user.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `MPM-BANK-${suffix}`,
      name: `Matcher PM Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [incomeAccount] = await db('accounts')
    .insert({
      code: `MPM-INC-${suffix}`,
      name: `Matcher PM Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `MPM-EQ-${suffix}`,
      name: `Matcher PM Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount || !incomeAccount || !equityAccount) throw new Error('Failed to create accounts');
  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Matcher PM Fund ${suffix}`,
      description: 'matcher payment method test fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create fund');
  createdFundIds.push(fund.id);

  return { userId: user.id, bankAccountId: bankAccount.id, incomeAccountId: incomeAccount.id, fundId: fund.id, suffix };
}

describe('runMatcher payment_method veto', () => {
  it('blocks auto-confirm when bank row is Interac e-Transfer but deposit was entered as cheque', async () => {
    const fx = await createFixture();
    const txDate = '2026-05-01';
    const description = 'Sunday deposit';
    const refNo = `CHQREF-${fx.suffix}`;
    const amount = 250;

    // Create a manual deposit transaction tagged as cheque
    const [tx] = await db('transactions')
      .insert({
        date: txDate,
        description,
        reference_no: refNo,
        payment_method: 'cheque',
        fund_id: fx.fundId,
        created_by: fx.userId,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*') as Array<{ id: number }>;
    if (!tx) throw new Error('Failed to create transaction');
    createdTransactionIds.push(tx.id);

    const [je] = await db('journal_entries')
      .insert({
        transaction_id: tx.id,
        account_id: fx.bankAccountId,
        fund_id: fx.fundId,
        debit: amount.toFixed(2),
        credit: '0.00',
        is_reconciled: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*') as Array<{ id: number }>;
    await db('journal_entries').insert({
      transaction_id: tx.id,
      account_id: fx.incomeAccountId,
      fund_id: fx.fundId,
      debit: '0.00',
      credit: amount.toFixed(2),
      is_reconciled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Create a bank upload then a bank transaction marked as Interac e-Transfer
    const [upload] = await db('bank_uploads')
      .insert({
        account_id: fx.bankAccountId,
        fund_id: fx.fundId,
        filename: `pm-veto-${fx.suffix}.csv`,
        uploaded_by: fx.userId,
        row_count: 1,
      })
      .returning('*') as Array<{ id: number }>;
    if (!upload) throw new Error('Failed to create bank upload');
    createdUploadIds.push(upload.id);

    const dummyFingerprint = 'a'.repeat(64);
    const [bankTx] = await db('bank_transactions')
      .insert({
        upload_id: upload.id,
        row_index: 0,
        bank_transaction_id: refNo,      // matches reference_no → score_ref = 100
        bank_posted_date: txDate,         // same date → score_date = 100
        raw_description: description,
        normalized_description: description.toLowerCase(),
        payment_method: 'Interac e-Transfer',
        amount: amount.toFixed(2),
        fingerprint: dummyFingerprint,
      })
      .returning('*') as Array<{ id: number }>;
    if (!bankTx) throw new Error('Failed to create bank transaction');

    const result = await db.transaction(async (trx: Knex.Transaction) =>
      runMatcher(bankTx.id, fx.userId, trx)
    );

    expect(result.auto_confirmed).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.auto_confirm_eligible).toBe(false);
    // _payment_method must not be exposed in the public response
    expect(result.candidates[0]).not.toHaveProperty('_payment_method');

    // Verify the bank_transactions row stayed at 'suggested', not 'confirmed'
    const dbRow = await db('bank_transactions').where({ id: bankTx.id }).first();
    expect(dbRow.match_status).toBe('suggested');
    expect(dbRow.suggested_match_id).toBe(je.id);
  });
});
