import dotenv from 'dotenv';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'development';

dotenv.config();

const db = require('../../../db') as Knex;

let applyBillCredits: typeof import('../billCredits.js').applyBillCredits;
let unapplyBillCredits: typeof import('../billCredits.js').unapplyBillCredits;

const createdBillIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

beforeAll(async () => {
  await db.raw('select 1');

  const billCredits = await import('../billCredits.js');
  applyBillCredits = billCredits.applyBillCredits;
  unapplyBillCredits = billCredits.unapplyBillCredits;
});

afterEach(async () => {
  await db('bill_credit_applications')
    .whereIn('target_bill_id', createdBillIds)
    .orWhereIn('credit_bill_id', createdBillIds)
    .delete();

  if (createdBillIds.length > 0) {
    await db('bills').whereIn('id', createdBillIds).delete();
    createdBillIds.length = 0;
  }

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

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function createFixture() {
  const suffix = uniqueSuffix();

  const [user] = await db('users')
    .insert({
      google_id: `bill-credit-user-${suffix}`,
      email: `bill-credit-user-${suffix}@example.com`,
      name: `Bill Credit User ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create bill credit fixture user');
  createdUserIds.push(user.id);

  const [vendor] = await db('contacts')
    .insert({
      type: 'PAYEE',
      contact_class: 'INDIVIDUAL',
      name: `Bill Credit Vendor ${suffix}`,
      email: `bill-credit-vendor-${suffix}@example.com`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!vendor) throw new Error('Failed to create bill credit fixture vendor');
  createdContactIds.push(vendor.id);

  const apAccount = await db('accounts')
    .where({ code: '20000', is_active: true })
    .first() as { id: number } | undefined;
  if (!apAccount) throw new Error('Expected active Accounts Payable account 20000 in development database');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `BCEQ-${suffix}`,
      name: `Bill Credit Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create bill credit fixture equity account');
  createdAccountIds.push(equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Bill Credit Fund ${suffix}`,
      description: 'Bill credit integration fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create bill credit fixture fund');
  createdFundIds.push(fund.id);

  return {
    userId: user.id,
    vendorId: vendor.id,
    apAccountId: apAccount.id,
    fundId: fund.id,
    suffix,
  };
}

async function createBill({
  contactId,
  fundId,
  userId,
  suffix,
  billNumber,
  amount,
  amountPaid = '0.00',
  status = 'UNPAID',
  date = '2026-04-01',
}: {
  contactId: number;
  fundId: number | null;
  userId: number;
  suffix: string;
  billNumber: string;
  amount: string;
  amountPaid?: string;
  status?: 'UNPAID' | 'PAID' | 'VOID';
  date?: string;
}) {
  const [bill] = await db('bills')
    .insert({
      contact_id: contactId,
      date,
      due_date: date,
      bill_number: `${billNumber}-${suffix}`,
      description: `Bill Credit ${billNumber} ${suffix}`,
      amount,
      amount_paid: amountPaid,
      status,
      fund_id: fundId,
      created_by: userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; bill_number: string }>;
  if (!bill) throw new Error('Failed to create bill credit fixture bill');
  createdBillIds.push(bill.id);
  return bill;
}

async function getBill(id: number) {
  return db('bills')
    .where({ id })
    .first() as Promise<{
      amount_paid: string | number;
      status: string;
      transaction_id: number | null;
      paid_by: number | null;
    } | undefined>;
}

describe('billCredits real DB integration', () => {
  it('fully applies and unapplies a vendor credit with real journal entries and application FKs', async () => {
    const fixture = await createFixture();
    const target = await createBill({
      contactId: fixture.vendorId,
      fundId: fixture.fundId,
      userId: fixture.userId,
      suffix: fixture.suffix,
      billNumber: 'TARGET-FULL',
      amount: '40.00',
    });
    const credit = await createBill({
      contactId: fixture.vendorId,
      fundId: fixture.fundId,
      userId: fixture.userId,
      suffix: fixture.suffix,
      billNumber: 'CREDIT-FULL',
      amount: '-40.00',
    });

    const applied = await applyBillCredits(
      String(target.id),
      { applications: [{ credit_bill_id: credit.id, amount: 40 }] },
      fixture.userId,
    );

    expect(applied.errors).toBeUndefined();
    expect(applied.bill).toEqual(expect.objectContaining({
      id: target.id,
      amount: 40,
      amount_paid: 40,
      status: 'PAID',
      available_credit_total: 0,
    }));
    expect(applied.applications).toEqual([
      expect.objectContaining({
        target_bill_id: target.id,
        credit_bill_id: credit.id,
        amount: 40,
        credit_bill_number: credit.bill_number,
      }),
    ]);
    expect(applied.transaction).toEqual(expect.objectContaining({
      id: expect.any(Number),
      fund_id: fixture.fundId,
      created_by: fixture.userId,
    }));
    const applyTransactionId = applied.transaction?.id as number;
    createdTransactionIds.push(applyTransactionId);

    const appRows = await db('bill_credit_applications')
      .where({ target_bill_id: target.id })
      .select('id', 'target_bill_id', 'credit_bill_id', 'amount', 'apply_transaction_id') as Array<{
        id: number;
        target_bill_id: number;
        credit_bill_id: number;
        amount: string | number;
        apply_transaction_id: number;
      }>;
    expect(appRows).toEqual([
      expect.objectContaining({
        target_bill_id: target.id,
        credit_bill_id: credit.id,
        amount: '40.00',
        apply_transaction_id: applyTransactionId,
      }),
    ]);

    const journalEntries = await db('journal_entries')
      .where({ transaction_id: applyTransactionId })
      .orderBy('id', 'asc')
      .select('transaction_id', 'account_id', 'fund_id', 'contact_id', 'debit', 'credit') as Array<{
        transaction_id: number;
        account_id: number;
        fund_id: number;
        contact_id: number | null;
        debit: string | number;
        credit: string | number;
      }>;
    expect(journalEntries).toEqual([
      expect.objectContaining({
        transaction_id: applyTransactionId,
        account_id: fixture.apAccountId,
        fund_id: fixture.fundId,
        contact_id: fixture.vendorId,
        debit: '40.00',
        credit: '0.00',
      }),
      expect.objectContaining({
        transaction_id: applyTransactionId,
        account_id: fixture.apAccountId,
        fund_id: fixture.fundId,
        contact_id: fixture.vendorId,
        debit: '0.00',
        credit: '40.00',
      }),
    ]);

    await expect(getBill(credit.id)).resolves.toEqual(expect.objectContaining({
      amount_paid: '-40.00',
      status: 'PAID',
      paid_by: fixture.userId,
    }));

    const unapplied = await unapplyBillCredits(String(target.id), fixture.userId);

    expect(unapplied.errors).toBeUndefined();
    expect(unapplied.unapplied_count).toBe(1);
    expect(unapplied.bill).toEqual(expect.objectContaining({
      id: target.id,
      amount: 40,
      amount_paid: 0,
      status: 'UNPAID',
      available_credit_total: 40,
    }));

    await expect(getBill(credit.id)).resolves.toEqual(expect.objectContaining({
      amount_paid: '0.00',
      status: 'UNPAID',
      paid_by: null,
    }));

    const storedApplyTransaction = await db('transactions')
      .where({ id: applyTransactionId })
      .first() as { is_voided: boolean } | undefined;
    expect(storedApplyTransaction?.is_voided).toBe(true);

    const unappliedApp = await db('bill_credit_applications')
      .where({ target_bill_id: target.id, credit_bill_id: credit.id })
      .first() as { unapplied_at: Date | null; unapplied_by: number | null } | undefined;
    expect(unappliedApp).toEqual(expect.objectContaining({
      unapplied_by: fixture.userId,
    }));
    expect(unappliedApp?.unapplied_at).toBeTruthy();
  });

  it('partially applies a credit and leaves the remaining target balance unpaid', async () => {
    const fixture = await createFixture();
    const target = await createBill({
      contactId: fixture.vendorId,
      fundId: fixture.fundId,
      userId: fixture.userId,
      suffix: fixture.suffix,
      billNumber: 'TARGET-PART',
      amount: '100.00',
    });
    const credit = await createBill({
      contactId: fixture.vendorId,
      fundId: fixture.fundId,
      userId: fixture.userId,
      suffix: fixture.suffix,
      billNumber: 'CREDIT-PART',
      amount: '-40.00',
    });

    const applied = await applyBillCredits(
      String(target.id),
      { applications: [{ credit_bill_id: credit.id, amount: 25 }] },
      fixture.userId,
    );

    expect(applied.errors).toBeUndefined();
    expect(applied.bill).toEqual(expect.objectContaining({
      id: target.id,
      amount: 100,
      amount_paid: 25,
      status: 'UNPAID',
      available_credit_total: 15,
    }));
    expect(applied.transaction).toEqual(expect.objectContaining({ id: expect.any(Number) }));
    const applyTransactionId = applied.transaction?.id as number;
    createdTransactionIds.push(applyTransactionId);

    await expect(getBill(credit.id)).resolves.toEqual(expect.objectContaining({
      amount_paid: '-25.00',
      status: 'UNPAID',
      paid_by: null,
    }));

    const application = await db('bill_credit_applications')
      .where({ target_bill_id: target.id, credit_bill_id: credit.id })
      .first() as { amount: string | number; apply_transaction_id: number } | undefined;
    expect(application).toEqual(expect.objectContaining({
      amount: '25.00',
      apply_transaction_id: applyTransactionId,
    }));

    const journalEntries = await db('journal_entries')
      .where({ transaction_id: applyTransactionId })
      .orderBy('id', 'asc')
      .select('transaction_id', 'account_id', 'fund_id', 'contact_id', 'debit', 'credit') as Array<{
        transaction_id: number;
        account_id: number;
        fund_id: number;
        contact_id: number | null;
        debit: string | number;
        credit: string | number;
      }>;
    expect(journalEntries).toEqual([
      expect.objectContaining({
        transaction_id: applyTransactionId,
        account_id: fixture.apAccountId,
        fund_id: fixture.fundId,
        contact_id: fixture.vendorId,
        debit: '25.00',
        credit: '0.00',
      }),
      expect.objectContaining({
        transaction_id: applyTransactionId,
        account_id: fixture.apAccountId,
        fund_id: fixture.fundId,
        contact_id: fixture.vendorId,
        debit: '0.00',
        credit: '25.00',
      }),
    ]);
  });

  it('rolls back bill updates and application rows when journal entry insert fails', async () => {
    const fixture = await createFixture();
    const target = await createBill({
      contactId: fixture.vendorId,
      fundId: null,
      userId: fixture.userId,
      suffix: fixture.suffix,
      billNumber: 'TARGET-ROLLBACK',
      amount: '50.00',
    });
    const credit = await createBill({
      contactId: fixture.vendorId,
      fundId: null,
      userId: fixture.userId,
      suffix: fixture.suffix,
      billNumber: 'CREDIT-ROLLBACK',
      amount: '-30.00',
    });

    await expect(applyBillCredits(
      String(target.id),
      { applications: [{ credit_bill_id: credit.id, amount: 30 }] },
      fixture.userId,
    )).rejects.toThrow();

    await expect(getBill(target.id)).resolves.toEqual(expect.objectContaining({
      amount_paid: '0.00',
      status: 'UNPAID',
      transaction_id: null,
      paid_by: null,
    }));
    await expect(getBill(credit.id)).resolves.toEqual(expect.objectContaining({
      amount_paid: '0.00',
      status: 'UNPAID',
      transaction_id: null,
      paid_by: null,
    }));

    const applications = await db('bill_credit_applications')
      .where({ target_bill_id: target.id });
    expect(applications).toEqual([]);

    const leakedTransactions = await db('transactions')
      .where({
        created_by: fixture.userId,
        reference_no: target.bill_number,
      });
    expect(leakedTransactions).toEqual([]);
  });
});
