import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';


dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

vi.mock('../../services/donationReceiptPdf.js', () => ({
  renderDonationReceiptsPdfBase64: vi.fn().mockResolvedValue('JVBERi0='),
}));

const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];

let donationReceiptsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const donationReceiptsModule = await import('../donationReceipts.js');
  donationReceiptsRouter = donationReceiptsModule.default as unknown as Router;
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
  method,
  role = 'viewer',
  body,
}: {
  probePath: string;
  method: 'GET' | 'POST';
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/donation-receipts',
    probePath,
    method,
    router: donationReceiptsRouter,
    role,
    body,
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
  const fiscalYear = Number(date.slice(0, 4));

  const [contact] = await db('contacts')
    .insert({
      type: 'DONOR',
      contact_class: 'INDIVIDUAL',
      name: `Receipt Donor ${suffix}`,
      first_name: 'Receipt',
      last_name: `Donor ${suffix}`,
      address_line1: '456 Receipt Road',
      city: 'Ottawa',
      province: 'ON',
      postal_code: 'K1A 0B1',
      donor_id: `RCPT-${suffix}`,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; name: string; donor_id: string }>;
  if (!contact) throw new Error('Failed to create donation receipt fixture contact');
  createdContactIds.push(contact.id);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `DRB-${suffix}`,
      name: `Donation Receipt Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount) throw new Error('Failed to create donation receipt fixture bank account');

  const [incomeAccount] = await db('accounts')
    .insert({
      code: `DRI-${suffix}`,
      name: `Donation Receipt Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number; code: string; name: string }>;
  if (!incomeAccount) throw new Error('Failed to create donation receipt fixture income account');

  const [equityAccount] = await db('accounts')
    .insert({
      code: `DRE-${suffix}`,
      name: `Donation Receipt Net Assets ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!equityAccount) throw new Error('Failed to create donation receipt fixture equity account');

  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Donation Receipt Fund ${suffix}`,
      description: 'Integration donation receipt fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create donation receipt fixture fund');
  createdFundIds.push(fund.id);

  const [transaction] = await db('transactions')
    .insert({
      date,
      description: `Donation Receipt Gift ${suffix}`,
      reference_no: `DR-${suffix}`,
      fund_id: fund.id,
      created_by: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create donation receipt fixture transaction');
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
    incomeAccount,
    fiscalYear,
  };
}

describe('direct DB donation-receipts integration smoke checks', () => {
  it('returns receipt accounts, template metadata, and preview from the development database', async () => {
    const fixture = await createDonationFixture();

    const accounts = await requestRoute({
      probePath: `/accounts?fiscal_year=${fixture.fiscalYear}`,
      method: 'GET',
    });

    expect(accounts.status).toBe(200);
    expect(accounts.body).toEqual(expect.objectContaining({
      fiscal_year: fixture.fiscalYear,
      period_start: expect.any(String),
      period_end: expect.any(String),
      accounts: expect.arrayContaining([
        expect.objectContaining({
          id: fixture.incomeAccount.id,
          code: fixture.incomeAccount.code,
          name: fixture.incomeAccount.name,
          total: 40,
        }),
      ]),
    }));

    const template = await requestRoute({
      probePath: '/template',
      method: 'GET',
    });

    expect(template.status).toBe(200);
    expect(template.body.template).toEqual(expect.objectContaining({
      markdown_body: expect.any(String),
    }));
    expect(template.body.variables).toEqual(expect.arrayContaining([
      'donor_name',
      'donor_id',
      'total_amount',
      'fiscal_year',
    ]));

    const preview = await requestRoute({
      probePath: '/preview',
      method: 'POST',
      role: 'editor',
      body: {
        fiscal_year: fixture.fiscalYear,
        account_ids: [fixture.incomeAccount.id],
        markdown_body: 'Donor {{donor_name}} / {{donor_id}} gave {{total_amount}} in {{fiscal_year}}',
      },
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      donor_count: 1,
      warnings: expect.any(Array),
      markdown: expect.stringContaining(fixture.contact.name),
    }));
    expect(preview.body.markdown).toContain(fixture.contact.donor_id);
    expect(preview.body.markdown).toContain('$40.00');
    expect(preview.body.markdown).toContain(String(fixture.fiscalYear));
  });

  it('rejects invalid donation receipt account ids before building receipts', async () => {
    const rejected = await requestRoute({
      probePath: '/preview',
      method: 'POST',
      role: 'editor',
      body: {
        fiscal_year: Number(todayDateOnly().slice(0, 4)),
        account_ids: [999999999],
        markdown_body: 'Donor {{donor_name}}',
      },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'Selected account IDs are not income accounts: 999999999' });
  });
});
