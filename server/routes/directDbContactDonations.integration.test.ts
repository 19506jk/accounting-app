import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from './routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];

let contactsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const contactsModule = await import('./contacts.js');
  contactsRouter = contactsModule.default as unknown as Router;
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
});

async function requestRoute({
  probePath,
  role = 'admin',
}: {
  probePath: string;
  role?: 'admin' | 'editor' | 'viewer';
}) {
  return requestMountedRoute({
    mountPath: '/api/contacts',
    probePath,
    router: contactsRouter,
    role,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

async function createDonationFixture() {
  const suffix = uniqueSuffix();
  const date = todayDateOnly();
  const year = Number(date.slice(0, 4));

  const [contact] = await db('contacts')
    .insert({
      type: 'DONOR',
      contact_class: 'INDIVIDUAL',
      name: `Integration Donor ${suffix}`,
      first_name: 'Integration',
      last_name: `Donor ${suffix}`,
      email: `donor-${suffix}@example.com`,
      phone: null,
      address_line1: '123 Test Street',
      address_line2: null,
      city: 'Ottawa',
      province: 'ON',
      postal_code: 'K1A 0B1',
      notes: null,
      donor_id: `DON-${suffix}`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string; donor_id: string }>;
  if (!contact) throw new Error('Failed to create donation fixture contact');
  createdContactIds.push(contact.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `IDBANK-${suffix}`,
      name: `Integration Donation Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount) throw new Error('Failed to create donation fixture bank account');

  const [incomeAccount] = await db('accounts')
    .insert({
      code: `IDINC-${suffix}`,
      name: `Integration Donation Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; code: string; name: string }>;
  if (!incomeAccount) throw new Error('Failed to create donation fixture income account');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `IDEQ-${suffix}`,
      name: `Integration Donation Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create donation fixture equity account');

  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Integration Donation Fund ${suffix}`,
      description: 'Integration donation fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string }>;
  if (!fund) throw new Error('Failed to create donation fixture fund');
  createdFundIds.push(fund.id);

  const [transaction] = await db('transactions')
    .insert({
      date,
      description: `Integration Donation ${suffix}`,
      reference_no: `DON-${suffix}`,
      fund_id: fund.id,
      created_by: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; description: string; reference_no: string }>;
  if (!transaction) throw new Error('Failed to create donation fixture transaction');
  createdTransactionIds.push(transaction.id);

  await db('journal_entries')
    .insert([
      {
        transaction_id: transaction.id,
        account_id: bankAccount.id,
        fund_id: fund.id,
        contact_id: null,
        debit: '40.00',
        credit: '0.00',
        memo: 'Bank deposit',
        is_reconciled: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        transaction_id: transaction.id,
        account_id: incomeAccount.id,
        fund_id: fund.id,
        contact_id: contact.id,
        debit: '0.00',
        credit: '40.00',
        memo: 'Receipt donation',
        is_reconciled: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ]);

  return {
    contact,
    fund,
    incomeAccount,
    transaction,
    date,
    year,
  };
}

describe('direct DB contact donation integration smoke checks', () => {
  it('returns donor donations, summary, receipt, and bulk receipt from the development database', async () => {
    const fixture = await createDonationFixture();

    const donations = await requestRoute({
      probePath: `/${fixture.contact.id}/donations?year=${fixture.year}`,
      role: 'viewer',
    });

    expect(donations.status).toBe(200);
    expect(donations.body.contact).toEqual({
      id: fixture.contact.id,
      name: fixture.contact.name,
      donor_id: fixture.contact.donor_id,
    });
    expect(donations.body.donations).toEqual([
      expect.objectContaining({
        transaction_id: fixture.transaction.id,
        date: expect.any(String),
        description: fixture.transaction.description,
        reference_no: fixture.transaction.reference_no,
        account_name: fixture.incomeAccount.name,
        account_code: fixture.incomeAccount.code,
        fund_name: fixture.fund.name,
        amount: 40,
        memo: 'Receipt donation',
      }),
    ]);

    const summary = await requestRoute({
      probePath: `/${fixture.contact.id}/donations/summary`,
      role: 'viewer',
    });

    expect(summary.status).toBe(200);
    expect(summary.body.summary).toEqual(expect.arrayContaining([
      {
        year: fixture.year,
        total: 40,
        donation_count: 1,
      },
    ]));

    const receipt = await requestRoute({
      probePath: `/${fixture.contact.id}/receipt?year=${fixture.year}`,
      role: 'viewer',
    });

    expect(receipt.status).toBe(200);
    expect(receipt.body.receipt).toEqual(expect.objectContaining({
      year: fixture.year,
      total: 40,
      eligible_amount: 40,
      donor: expect.objectContaining({
        name: fixture.contact.name,
        donor_id: fixture.contact.donor_id,
      }),
          donations: [
            expect.objectContaining({
          date: expect.any(String),
          description: fixture.transaction.description,
          reference_no: fixture.transaction.reference_no,
          account_name: fixture.incomeAccount.name,
          amount: 40,
          memo: 'Receipt donation',
        }),
      ],
    }));

    const bulk = await requestRoute({
      probePath: `/receipts/bulk?year=${fixture.year}`,
      role: 'admin',
    });

    expect(bulk.status).toBe(200);
    expect(bulk.body).toEqual(expect.objectContaining({
      year: fixture.year,
      count: expect.any(Number),
      receipts: expect.arrayContaining([
        expect.objectContaining({
          donor: expect.objectContaining({
            id: fixture.contact.id,
            name: fixture.contact.name,
            donor_id: fixture.contact.donor_id,
          }),
          year: fixture.year,
          total: 40,
          eligible_amount: 40,
          donations: [
            expect.objectContaining({
              date: expect.any(String),
              description: fixture.transaction.description,
              account_name: fixture.incomeAccount.name,
              amount: 40,
            }),
          ],
        }),
      ]),
    }));
  });
});
