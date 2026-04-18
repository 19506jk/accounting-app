import dotenv from 'dotenv';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

dotenv.config();

const db = require('../../db') as Knex;

let reports: typeof import('../reports.js');

const createdFiscalPeriodIds: number[] = [];
const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const createdUserIds: number[] = [];

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

type AccountFixture = {
  id: number;
  code: string;
  name: string;
  type: AccountType;
};

type FundFixture = {
  id: number;
  name: string;
};

type ContactFixture = {
  id: number;
  name: string;
  donor_id: string | null;
  contact_class: 'INDIVIDUAL' | 'HOUSEHOLD';
};

type EntryInput = {
  account_id: number;
  fund_id: number;
  debit: string | number;
  credit: string | number;
  contact_id?: number | null;
  memo?: string | null;
};

beforeAll(async () => {
  await db.raw('select 1');
  reports = await import('../reports.js');
});

afterEach(async () => {
  if (createdFiscalPeriodIds.length > 0) {
    await db('fiscal_periods').whereIn('id', createdFiscalPeriodIds).delete();
    createdFiscalPeriodIds.length = 0;
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
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function createUser(suffix: string) {
  const [user] = await db('users')
    .insert({
      google_id: `reports-service-${suffix}`,
      email: `reports-service-${suffix}@example.com`,
      name: `Reports Service ${suffix}`,
      role: 'admin',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!user) throw new Error('Failed to create report user fixture');
  createdUserIds.push(user.id);
  return user.id;
}

async function createAccount(suffix: string, type: AccountType, label: string): Promise<AccountFixture> {
  const code = `R${label}${suffix}`.slice(0, 30);
  const [account] = await db('accounts')
    .insert({
      code,
      name: `Reports ${label} ${suffix}`,
      type,
      account_class: type,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id', 'code', 'name', 'type']) as AccountFixture[];
  if (!account) throw new Error(`Failed to create ${label} account fixture`);
  createdAccountIds.push(account.id);
  return account;
}

async function createFund(suffix: string, label: string, netAssetAccountId: number | null): Promise<FundFixture> {
  const [fund] = await db('funds')
    .insert({
      name: `Reports Fund ${label} ${suffix}`,
      description: `Reports ${label} fixture fund`,
      net_asset_account_id: netAssetAccountId,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id', 'name']) as FundFixture[];
  if (!fund) throw new Error(`Failed to create ${label} fund fixture`);
  createdFundIds.push(fund.id);
  return fund;
}

async function createContact(suffix: string, label: string): Promise<ContactFixture> {
  const [contact] = await db('contacts')
    .insert({
      type: 'DONOR',
      contact_class: 'INDIVIDUAL',
      name: `Reports Donor ${label} ${suffix}`,
      donor_id: `RPT-${label}-${suffix}`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning(['id', 'name', 'donor_id', 'contact_class']) as ContactFixture[];
  if (!contact) throw new Error(`Failed to create ${label} contact fixture`);
  createdContactIds.push(contact.id);
  return contact;
}

async function createTransaction({
  suffix,
  date,
  description,
  referenceNo,
  fundId,
  userId = null,
  isClosingEntry = false,
  entries,
}: {
  suffix: string;
  date: string;
  description: string;
  referenceNo: string;
  fundId: number;
  userId?: number | null;
  isClosingEntry?: boolean;
  entries: EntryInput[];
}) {
  const [transaction] = await db('transactions')
    .insert({
      date,
      description: `${description} ${suffix}`,
      reference_no: `${referenceNo}-${suffix}`,
      fund_id: fundId,
      created_by: userId,
      is_closing_entry: isClosingEntry,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create report transaction fixture');
  createdTransactionIds.push(transaction.id);

  await db('journal_entries')
    .insert(entries.map((entry) => ({
      transaction_id: transaction.id,
      account_id: entry.account_id,
      fund_id: entry.fund_id,
      contact_id: entry.contact_id ?? null,
      debit: String(entry.debit),
      credit: String(entry.credit),
      memo: entry.memo ?? null,
      is_reconciled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })));

  return transaction.id;
}

async function createBaseFixture(label: string) {
  const suffix = uniqueSuffix();
  const userId = await createUser(suffix);
  const bank = await createAccount(suffix, 'ASSET', `BANK${label}`);
  const liability = await createAccount(suffix, 'LIABILITY', `LIAB${label}`);
  const income = await createAccount(suffix, 'INCOME', `INC${label}`);
  const otherIncome = await createAccount(suffix, 'INCOME', `OINC${label}`);
  const expense = await createAccount(suffix, 'EXPENSE', `EXP${label}`);
  const equity = await createAccount(suffix, 'EQUITY', `EQ${label}`);
  const fund = await createFund(suffix, label, equity.id);
  const donorA = await createContact(suffix, `${label}A`);
  const donorB = await createContact(suffix, `${label}B`);

  return {
    suffix,
    userId,
    bank,
    liability,
    income,
    otherIncome,
    expense,
    equity,
    fund,
    donorA,
    donorB,
  };
}

async function createFiscalPeriod(fiscalYear: number, periodStart: string, periodEnd: string, userId: number) {
  const [period] = await db('fiscal_periods')
    .insert({
      fiscal_year: fiscalYear,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'HARD_CLOSED',
      closed_by: userId,
      closed_at: db.fn.now(),
      created_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!period) throw new Error('Failed to create fiscal period fixture');
  createdFiscalPeriodIds.push(period.id);
  return period.id;
}

describe('reports service', () => {
  it('returns empty P&L data and filters P&L rows by fund', async () => {
    const fixtureA = await createBaseFixture('PL-A');
    const fixtureB = await createBaseFixture('PL-B');

    const empty = await reports.getPL({
      from: '2099-01-01',
      to: '2099-01-31',
      fundId: String(fixtureA.fund.id),
    });
    expect(empty).toEqual({
      income: [],
      expenses: [],
      total_income: 0,
      total_expenses: 0,
      net_surplus: 0,
    });

    await createTransaction({
      suffix: fixtureA.suffix,
      date: '2026-04-05',
      description: 'PL Fund A income',
      referenceNo: 'PL-A-IN',
      fundId: fixtureA.fund.id,
      userId: fixtureA.userId,
      entries: [
        { account_id: fixtureA.bank.id, fund_id: fixtureA.fund.id, debit: '100.00', credit: '0.00' },
        { account_id: fixtureA.income.id, fund_id: fixtureA.fund.id, debit: '0.00', credit: '100.00' },
      ],
    });
    await createTransaction({
      suffix: fixtureA.suffix,
      date: '2026-04-06',
      description: 'PL Fund A expense',
      referenceNo: 'PL-A-EX',
      fundId: fixtureA.fund.id,
      userId: fixtureA.userId,
      entries: [
        { account_id: fixtureA.expense.id, fund_id: fixtureA.fund.id, debit: '25.00', credit: '0.00' },
        { account_id: fixtureA.bank.id, fund_id: fixtureA.fund.id, debit: '0.00', credit: '25.00' },
      ],
    });
    await createTransaction({
      suffix: fixtureB.suffix,
      date: '2026-04-05',
      description: 'PL Fund B income',
      referenceNo: 'PL-B-IN',
      fundId: fixtureB.fund.id,
      userId: fixtureB.userId,
      entries: [
        { account_id: fixtureB.bank.id, fund_id: fixtureB.fund.id, debit: '200.00', credit: '0.00' },
        { account_id: fixtureB.income.id, fund_id: fixtureB.fund.id, debit: '0.00', credit: '200.00' },
      ],
    });

    const filtered = await reports.getPL({
      from: '2026-04-01',
      to: '2026-04-30',
      fundId: String(fixtureA.fund.id),
    });

    expect(filtered).toEqual(expect.objectContaining({
      total_income: 100,
      total_expenses: 25,
      net_surplus: 75,
    }));
    expect(filtered.income).toEqual([
      expect.objectContaining({ id: fixtureA.income.id, amount: 100 }),
    ]);
    expect(filtered.expenses).toEqual([
      expect.objectContaining({ id: fixtureA.expense.id, amount: 25 }),
    ]);
  });

  it('reports balance sheet hard-close, synthetic equity, mapped/unmapped diagnostics, and unbalanced state', async () => {
    const fixture = await createBaseFixture('BS');
    await createFiscalPeriod(2025, '2025-01-01', '2025-12-31', fixture.userId);

    await createTransaction({
      suffix: fixture.suffix,
      date: '2025-12-30',
      description: 'Pre-close income',
      referenceNo: 'BS-PRE',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '40.00', credit: '0.00' },
        { account_id: fixture.income.id, fund_id: fixture.fund.id, debit: '0.00', credit: '40.00' },
      ],
    });
    await createTransaction({
      suffix: fixture.suffix,
      date: '2025-12-31',
      description: 'Closing entry',
      referenceNo: 'BS-CLOSE',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      isClosingEntry: true,
      entries: [
        { account_id: fixture.income.id, fund_id: fixture.fund.id, debit: '40.00', credit: '0.00' },
        { account_id: fixture.equity.id, fund_id: fixture.fund.id, debit: '0.00', credit: '40.00' },
      ],
    });
    await createTransaction({
      suffix: fixture.suffix,
      date: '2026-01-10',
      description: 'Post-close income',
      referenceNo: 'BS-CUR',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '25.00', credit: '0.00' },
        { account_id: fixture.income.id, fund_id: fixture.fund.id, debit: '0.00', credit: '25.00' },
      ],
    });

    const closed = await reports.getBalanceSheet({ asOf: '2026-04-30', fundId: String(fixture.fund.id) });
    expect(closed.last_hard_close_date).toBe('2025-12-31');
    expect(closed.equity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: fixture.equity.id,
        balance: 40,
      }),
      expect.objectContaining({
        name: `[System] Net Income (Current Year) - ${fixture.fund.name}`,
        balance: 25,
      }),
    ]));
    expect(closed.equity).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: `[System] Net Income (Prior Years) - ${fixture.fund.name}`,
      }),
    ]));

    const unmappedFund = await createFund(fixture.suffix, 'UNMAPPED', null);
    await createTransaction({
      suffix: fixture.suffix,
      date: '2024-11-15',
      description: 'Unmapped prior income',
      referenceNo: 'BS-UNMAP',
      fundId: unmappedFund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: unmappedFund.id, debit: '30.00', credit: '0.00' },
        { account_id: fixture.income.id, fund_id: unmappedFund.id, debit: '0.00', credit: '30.00' },
      ],
    });

    const unmapped = await reports.getBalanceSheet({ asOf: '2025-12-30', fundId: String(unmappedFund.id) });
    expect(unmapped.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNMAPPED_FUND_NET_ASSET', fund_id: unmappedFund.id }),
      expect.objectContaining({ code: 'SUGGEST_HARD_CLOSE', fund_id: unmappedFund.id }),
      expect.objectContaining({ code: 'BALANCED', fund_id: unmappedFund.id }),
    ]));

    await createTransaction({
      suffix: fixture.suffix,
      date: '2026-04-20',
      description: 'Unbalanced asset only',
      referenceNo: 'BS-UNBAL',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '10.00', credit: '0.00' },
      ],
    });

    const unbalanced = await reports.getBalanceSheet({ asOf: '2026-04-30', fundId: String(fixture.fund.id) });
    expect(unbalanced.is_balanced).toBe(false);
    expect(unbalanced.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNBALANCED', fund_id: fixture.fund.id }),
    ]));
  });

  it('reports trial balance abnormal balances, zero-balance income filtering, and deduped synthetic diagnostics', async () => {
    const fixture = await createBaseFixture('TB');
    const zeroIncome = await createAccount(fixture.suffix, 'INCOME', 'ZERO');
    const unmappedFund = await createFund(fixture.suffix, 'TBUNMAPPED', null);

    await createTransaction({
      suffix: fixture.suffix,
      date: '2026-04-10',
      description: 'Abnormal asset credit',
      referenceNo: 'TB-ABN',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '0.00', credit: '20.00' },
      ],
    });
    await createTransaction({
      suffix: fixture.suffix,
      date: '2025-03-01',
      description: 'Unmapped prior one',
      referenceNo: 'TB-PR1',
      fundId: unmappedFund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: unmappedFund.id, debit: '10.00', credit: '0.00' },
        { account_id: fixture.income.id, fund_id: unmappedFund.id, debit: '0.00', credit: '10.00' },
      ],
    });
    await createTransaction({
      suffix: fixture.suffix,
      date: '2025-03-02',
      description: 'Unmapped prior two',
      referenceNo: 'TB-PR2',
      fundId: unmappedFund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: unmappedFund.id, debit: '15.00', credit: '0.00' },
        { account_id: fixture.income.id, fund_id: unmappedFund.id, debit: '0.00', credit: '15.00' },
      ],
    });

    const abnormal = await reports.getTrialBalance({ asOf: '2026-04-30', fundId: String(fixture.fund.id) });
    expect(abnormal.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'ABNORMAL_BALANCE',
        account_id: fixture.bank.id,
        fund_id: fixture.fund.id,
        investigate_filters: expect.objectContaining({
          account_id: fixture.bank.id,
          fund_id: fixture.fund.id,
        }),
      }),
    ]));
    expect(abnormal.accounts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: zeroIncome.id }),
    ]));

    const synthetic = await reports.getTrialBalance({ asOf: '2026-04-30', fundId: String(unmappedFund.id) });
    expect(synthetic.diagnostics.filter((diagnostic) => diagnostic.code === 'SUGGEST_HARD_CLOSE' && diagnostic.fund_id === unmappedFund.id)).toHaveLength(1);
    expect(synthetic.diagnostics.filter((diagnostic) => diagnostic.code === 'UNMAPPED_FUND_NET_ASSET' && diagnostic.fund_id === unmappedFund.id)).toHaveLength(1);
  });

  it('returns ledger opening balances, account filters, and empty account state', async () => {
    const fixture = await createBaseFixture('LED');
    const emptyAsset = await createAccount(fixture.suffix, 'ASSET', 'EMPTY');

    await createTransaction({
      suffix: fixture.suffix,
      date: '2026-03-15',
      description: 'Ledger opening',
      referenceNo: 'LED-OPEN',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '75.00', credit: '0.00' },
        { account_id: fixture.income.id, fund_id: fixture.fund.id, debit: '0.00', credit: '75.00' },
      ],
    });
    await createTransaction({
      suffix: fixture.suffix,
      date: '2026-04-10',
      description: 'Ledger current',
      referenceNo: 'LED-CUR',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '25.00', credit: '0.00' },
        { account_id: fixture.income.id, fund_id: fixture.fund.id, debit: '0.00', credit: '25.00' },
      ],
    });

    const ledger = await reports.getLedger({
      from: '2026-04-01',
      to: '2026-04-30',
      fundId: String(fixture.fund.id),
      accountId: String(fixture.bank.id),
    });

    expect(ledger.ledger).toEqual([
      expect.objectContaining({
        account: expect.objectContaining({ id: fixture.bank.id }),
        opening_balance: 75,
        closing_balance: 100,
        rows: [
          expect.objectContaining({
            date: '2026-04-10',
            debit: 25,
            credit: 0,
            balance: 100,
          }),
        ],
      }),
    ]);

    const empty = await reports.getLedger({
      from: '2026-04-01',
      to: '2026-04-30',
      fundId: String(fixture.fund.id),
      accountId: String(emptyAsset.id),
    });
    expect(empty.ledger).toEqual([
      expect.objectContaining({
        account: expect.objectContaining({ id: emptyAsset.id }),
        opening_balance: 0,
        closing_balance: 0,
        rows: [],
      }),
    ]);
  });

  it('filters donor summary/detail by income account and handles anonymous donations', async () => {
    const fixture = await createBaseFixture('DON');

    await createTransaction({
      suffix: fixture.suffix,
      date: '2026-04-05',
      description: 'Donor target account',
      referenceNo: 'DON-A',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '120.00', credit: '0.00' },
        {
          account_id: fixture.income.id,
          fund_id: fixture.fund.id,
          debit: '0.00',
          credit: '120.00',
          contact_id: fixture.donorA.id,
          memo: 'Target account donor',
        },
      ],
    });
    await createTransaction({
      suffix: fixture.suffix,
      date: '2026-04-06',
      description: 'Anonymous target account',
      referenceNo: 'DON-ANON',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '15.00', credit: '0.00' },
        {
          account_id: fixture.income.id,
          fund_id: fixture.fund.id,
          debit: '0.00',
          credit: '15.00',
          contact_id: null,
          memo: 'Anonymous target account',
        },
      ],
    });
    await createTransaction({
      suffix: fixture.suffix,
      date: '2026-04-07',
      description: 'Other account donor',
      referenceNo: 'DON-B',
      fundId: fixture.fund.id,
      userId: fixture.userId,
      entries: [
        { account_id: fixture.bank.id, fund_id: fixture.fund.id, debit: '80.00', credit: '0.00' },
        {
          account_id: fixture.otherIncome.id,
          fund_id: fixture.fund.id,
          debit: '0.00',
          credit: '80.00',
          contact_id: fixture.donorB.id,
          memo: 'Other account donor',
        },
      ],
    });

    const summary = await reports.getDonorSummary({
      from: '2026-04-01',
      to: '2026-04-30',
      fundId: String(fixture.fund.id),
      accountIds: [fixture.income.id],
    });
    expect(summary).toEqual(expect.objectContaining({
      donors: [
        expect.objectContaining({
          contact_id: fixture.donorA.id,
          total: 120,
          transaction_count: 1,
        }),
      ],
      anonymous: {
        total: 15,
        transaction_count: 1,
      },
      grand_total: 135,
      donor_count: 1,
    }));

    const detail = await reports.getDonorDetail({
      from: '2026-04-01',
      to: '2026-04-30',
      fundId: String(fixture.fund.id),
      contactId: String(fixture.donorA.id),
      accountIds: [fixture.income.id],
    });
    expect(detail).toEqual({
      donors: [
        expect.objectContaining({
          contact_id: fixture.donorA.id,
          total: 120,
          transactions: [
            expect.objectContaining({
              account_id: fixture.income.id,
              amount: 120,
              memo: 'Target account donor',
            }),
          ],
        }),
      ],
      anonymous: null,
      grand_total: 120,
    });

    const detailWithAnonymous = await reports.getDonorDetail({
      from: '2026-04-01',
      to: '2026-04-30',
      fundId: String(fixture.fund.id),
      accountIds: [fixture.income.id],
    });
    expect(detailWithAnonymous.anonymous).toEqual(expect.objectContaining({
      total: 15,
      transactions: [
        expect.objectContaining({
          amount: 15,
          memo: 'Anonymous target account',
        }),
      ],
    }));
    expect(detailWithAnonymous.donors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ contact_id: fixture.donorB.id }),
    ]));
  });
});
