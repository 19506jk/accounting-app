import dotenv from 'dotenv';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'development';
dotenv.config();

const db = require('../../../db') as Knex;
let listTransactions: (typeof import('../list.js'))['listTransactions'];

const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

beforeAll(async () => {
  await db.raw('select 1');
  const module = await import('../list.js');
  listTransactions = module.listTransactions;
});

afterEach(async () => {
  if (createdTransactionIds.length > 0) {
    await db('transactions').whereIn('id', createdTransactionIds).delete();
    createdTransactionIds.length = 0;
  }

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

type Fixture = {
  userId: number;
  fundAId: number;
  fundBId: number;
  bankId: number;
  transferAssetId: number;
  incomeId: number;
  expenseId: number;
  contactAId: number;
  contactBId: number;
  suffix: string;
};

type EntryInput = {
  account_id: number;
  fund_id: number;
  debit: number;
  credit: number;
  contact_id?: number | null;
  memo?: string;
};

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function createFixture(): Promise<Fixture> {
  const suffix = uniqueSuffix();

  const [user] = await db('users')
    .insert({
      google_id: `list-service-${suffix}`,
      email: `list-service-${suffix}@example.com`,
      name: `List Service ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create user fixture');
  createdUserIds.push(user.id);

  const [bank] = await db('accounts')
    .insert({
      code: `LST-BANK-${suffix}`,
      name: `List Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [transferAsset] = await db('accounts')
    .insert({
      code: `LST-ASSET-${suffix}`,
      name: `List Transfer Asset ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [income] = await db('accounts')
    .insert({
      code: `LST-INC-${suffix}`,
      name: `List Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [expense] = await db('accounts')
    .insert({
      code: `LST-EXP-${suffix}`,
      name: `List Expense ${suffix}`,
      type: 'EXPENSE',
      account_class: 'EXPENSE',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityA] = await db('accounts')
    .insert({
      code: `LST-EQ-A-${suffix}`,
      name: `List Equity A ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityB] = await db('accounts')
    .insert({
      code: `LST-EQ-B-${suffix}`,
      name: `List Equity B ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bank || !transferAsset || !income || !expense || !equityA || !equityB) {
    throw new Error('Failed to create account fixtures');
  }
  createdAccountIds.push(bank.id, transferAsset.id, income.id, expense.id, equityA.id, equityB.id);

  const [fundA] = await db('funds')
    .insert({
      name: `List Fund A ${suffix}`,
      description: 'List service fixture fund A',
      net_asset_account_id: equityA.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [fundB] = await db('funds')
    .insert({
      name: `List Fund B ${suffix}`,
      description: 'List service fixture fund B',
      net_asset_account_id: equityB.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fundA || !fundB) throw new Error('Failed to create fund fixtures');
  createdFundIds.push(fundA.id, fundB.id);

  const [contactA] = await db('contacts')
    .insert({
      type: 'DONOR',
      contact_class: 'INDIVIDUAL',
      name: `List Contact A ${suffix}`,
      donor_id: `LST-CTA-${suffix}`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [contactB] = await db('contacts')
    .insert({
      type: 'PAYEE',
      contact_class: 'INDIVIDUAL',
      name: `List Contact B ${suffix}`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!contactA || !contactB) throw new Error('Failed to create contact fixtures');
  createdContactIds.push(contactA.id, contactB.id);

  return {
    userId: user.id,
    fundAId: fundA.id,
    fundBId: fundB.id,
    bankId: bank.id,
    transferAssetId: transferAsset.id,
    incomeId: income.id,
    expenseId: expense.id,
    contactAId: contactA.id,
    contactBId: contactB.id,
    suffix,
  };
}

async function createTransaction({
  date,
  description,
  reference_no,
  fund_id,
  created_by,
  is_voided = false,
  created_at,
  entries,
}: {
  date: string;
  description: string;
  reference_no: string;
  fund_id: number;
  created_by: number;
  is_voided?: boolean;
  created_at: string;
  entries: EntryInput[];
}) {
  const [transaction] = await db('transactions')
    .insert({
      date,
      description,
      reference_no,
      fund_id,
      is_voided,
      created_by,
      created_at,
      updated_at: created_at,
    })
    .returning('*') as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create transaction fixture');
  createdTransactionIds.push(transaction.id);

  await db('journal_entries').insert(
    entries.map((entry) => ({
      transaction_id: transaction.id,
      account_id: entry.account_id,
      fund_id: entry.fund_id,
      contact_id: entry.contact_id ?? null,
      debit: entry.debit.toFixed(2),
      credit: entry.credit.toFixed(2),
      memo: entry.memo || null,
      is_reconciled: false,
      created_at,
      updated_at: created_at,
    }))
  );

  return transaction.id;
}

describe('listTransactions integration', () => {
  it('coerces include_inactive and includes or excludes voided transactions correctly', async () => {
    const fixture = await createFixture();

    const activeId = await createTransaction({
      date: '2026-04-17',
      description: `Active ${fixture.suffix}`,
      reference_no: `ACT-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-17T10:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 25, credit: 0, contact_id: fixture.contactAId },
        { account_id: fixture.incomeId, fund_id: fixture.fundAId, debit: 0, credit: 25, contact_id: fixture.contactAId },
      ],
    });
    const voidedId = await createTransaction({
      date: '2026-04-16',
      description: `Voided ${fixture.suffix}`,
      reference_no: `VOID-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      is_voided: true,
      created_at: '2026-04-16T10:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 9, credit: 0, contact_id: fixture.contactAId },
        { account_id: fixture.incomeId, fund_id: fixture.fundAId, debit: 0, credit: 9, contact_id: fixture.contactAId },
      ],
    });

    const asStringTrue = await listTransactions({ include_inactive: 'true' });
    expect(asStringTrue.transactions.map((t) => t.id)).toEqual(expect.arrayContaining([activeId, voidedId]));

    const asBooleanTrue = await listTransactions({ include_inactive: true });
    expect(asBooleanTrue.transactions.map((t) => t.id)).toEqual(expect.arrayContaining([activeId, voidedId]));

    const asStringFalse = await listTransactions({ include_inactive: 'false' });
    expect(asStringFalse.transactions.map((t) => t.id)).toContain(activeId);
    expect(asStringFalse.transactions.map((t) => t.id)).not.toContain(voidedId);

    const asBooleanFalse = await listTransactions({ include_inactive: false });
    expect(asBooleanFalse.transactions.map((t) => t.id)).toContain(activeId);
    expect(asBooleanFalse.transactions.map((t) => t.id)).not.toContain(voidedId);

    const omitted = await listTransactions({});
    expect(omitted.transactions.map((t) => t.id)).toContain(activeId);
    expect(omitted.transactions.map((t) => t.id)).not.toContain(voidedId);
  });

  it('applies fund/account/contact filters and includes from/to boundary dates', async () => {
    const fixture = await createFixture();

    const boundaryId = await createTransaction({
      date: '2026-04-17',
      description: `Boundary ${fixture.suffix}`,
      reference_no: `BOUND-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-17T11:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 60, credit: 0, contact_id: fixture.contactAId },
        { account_id: fixture.incomeId, fund_id: fixture.fundAId, debit: 0, credit: 60, contact_id: fixture.contactAId },
      ],
    });
    await createTransaction({
      date: '2026-04-18',
      description: `Other Fund ${fixture.suffix}`,
      reference_no: `OTHER-${fixture.suffix}`,
      fund_id: fixture.fundBId,
      created_by: fixture.userId,
      created_at: '2026-04-18T11:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundBId, debit: 44, credit: 0, contact_id: fixture.contactBId },
        { account_id: fixture.incomeId, fund_id: fixture.fundBId, debit: 0, credit: 44, contact_id: fixture.contactBId },
      ],
    });

    const result = await listTransactions({
      fund_id: fixture.fundAId,
      account_id: fixture.incomeId,
      contact_id: fixture.contactAId,
      from: '2026-04-17',
      to: '2026-04-17',
    });

    expect(result.total).toBe(1);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.id).toBe(boundaryId);
  });

  it('classifies transaction_type and sets aggregation/shape fields', async () => {
    const fixture = await createFixture();

    const depositId = await createTransaction({
      date: '2026-04-17',
      description: `Deposit ${fixture.suffix}`,
      reference_no: `DEP-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-17T12:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 100, credit: 0, contact_id: fixture.contactAId },
        { account_id: fixture.incomeId, fund_id: fixture.fundAId, debit: 0, credit: 100, contact_id: fixture.contactAId },
      ],
    });
    const withdrawalId = await createTransaction({
      date: '2026-04-16',
      description: `Withdrawal ${fixture.suffix}`,
      reference_no: `WDR-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-16T12:00:00.000Z',
      entries: [
        { account_id: fixture.expenseId, fund_id: fixture.fundAId, debit: 30, credit: 0, contact_id: fixture.contactAId },
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 0, credit: 30, contact_id: fixture.contactAId },
      ],
    });
    const transferId = await createTransaction({
      date: '2026-04-15',
      description: `Transfer ${fixture.suffix}`,
      reference_no: `TRF-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-15T12:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 0, credit: 80, contact_id: fixture.contactAId },
        { account_id: fixture.transferAssetId, fund_id: fixture.fundAId, debit: 80, credit: 0, contact_id: fixture.contactBId },
      ],
    });
    const mixedId = await createTransaction({
      date: '2026-04-14',
      description: `Mixed ${fixture.suffix}`,
      reference_no: `MIX-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-14T12:00:00.000Z',
      entries: [
        { account_id: fixture.incomeId, fund_id: fixture.fundAId, debit: 0, credit: 50, contact_id: fixture.contactAId },
        { account_id: fixture.expenseId, fund_id: fixture.fundAId, debit: 50, credit: 0, contact_id: fixture.contactAId },
      ],
    });
    const noContactId = await createTransaction({
      date: '2026-04-13',
      description: `No Contact ${fixture.suffix}`,
      reference_no: `NCT-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-13T12:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 10, credit: 0 },
        { account_id: fixture.incomeId, fund_id: fixture.fundAId, debit: 0, credit: 10 },
      ],
    });

    const result = await listTransactions({
      fund_id: fixture.fundAId,
      include_inactive: true,
      limit: 200,
    });
    const byId = new Map(result.transactions.map((transaction) => [transaction.id, transaction]));

    expect(byId.get(depositId)?.transaction_type).toBe('deposit');
    expect(byId.get(withdrawalId)?.transaction_type).toBe('withdrawal');
    expect(byId.get(transferId)?.transaction_type).toBe('transfer');
    expect(byId.get(mixedId)?.transaction_type).toBe('deposit');

    expect(byId.get(depositId)).toEqual(expect.objectContaining({
      total_amount: 100,
      contact_name: expect.stringContaining('List Contact A'),
      has_multiple_contacts: false,
      is_voided: false,
      date: '2026-04-17',
      created_at: expect.any(String),
    }));
    expect(byId.get(transferId)).toEqual(expect.objectContaining({
      total_amount: 80,
      contact_name: null,
      has_multiple_contacts: true,
    }));
    expect(byId.get(noContactId)).toEqual(expect.objectContaining({
      contact_name: null,
      has_multiple_contacts: false,
    }));
  });

  it('applies pagination defaults and max cap, plus date/created_at ordering', async () => {
    const fixture = await createFixture();

    const txA = await createTransaction({
      date: '2026-04-20',
      description: `Order A ${fixture.suffix}`,
      reference_no: `ORD-A-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-20T10:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 15, credit: 0 },
        { account_id: fixture.transferAssetId, fund_id: fixture.fundAId, debit: 0, credit: 15 },
      ],
    });
    const txB = await createTransaction({
      date: '2026-04-20',
      description: `Order B ${fixture.suffix}`,
      reference_no: `ORD-B-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-20T11:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 16, credit: 0 },
        { account_id: fixture.transferAssetId, fund_id: fixture.fundAId, debit: 0, credit: 16 },
      ],
    });
    await createTransaction({
      date: '2026-04-19',
      description: `Order C ${fixture.suffix}`,
      reference_no: `ORD-C-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-20T09:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 17, credit: 0 },
        { account_id: fixture.transferAssetId, fund_id: fixture.fundAId, debit: 0, credit: 17 },
      ],
    });
    const txD = await createTransaction({
      date: '2026-04-20',
      description: `Order D ${fixture.suffix}`,
      reference_no: `ORD-D-${fixture.suffix}`,
      fund_id: fixture.fundAId,
      created_by: fixture.userId,
      created_at: '2026-04-20T12:00:00.000Z',
      entries: [
        { account_id: fixture.bankId, fund_id: fixture.fundAId, debit: 18, credit: 0 },
        { account_id: fixture.transferAssetId, fund_id: fixture.fundAId, debit: 0, credit: 18 },
      ],
    });

    const defaults = await listTransactions({});
    expect(defaults.limit).toBe(50);
    expect(defaults.offset).toBe(0);

    const paged = await listTransactions({
      fund_id: fixture.fundAId,
      from: '2026-04-19',
      to: '2026-04-20',
      limit: 999,
      offset: 1,
      include_inactive: true,
    });
    expect(paged.limit).toBe(200);
    expect(paged.offset).toBe(1);
    expect(paged.total).toBe(4);

    const ids = paged.transactions.map((transaction) => transaction.id);
    expect(ids).toContain(txA);
    expect(ids).toContain(txB);
    expect(ids).not.toContain(txD);

    const orderedSlice = await listTransactions({
      fund_id: fixture.fundAId,
      from: '2026-04-19',
      to: '2026-04-20',
      limit: 2,
      offset: 1,
      include_inactive: true,
    });
    expect(orderedSlice.transactions.map((transaction) => transaction.id)).toEqual([txB, txA]);
  });
});
