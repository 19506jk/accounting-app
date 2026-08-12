import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  role = 'admin',
  body,
}: {
  probePath: string;
  method: 'GET' | 'POST' | 'PUT';
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
      html_body: expect.any(String),
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
      body: {
        fiscal_year: fixture.fiscalYear,
        account_ids: [fixture.incomeAccount.id],
        html_body: 'Donor {{donor_name}} / {{donor_id}} gave {{total_amount}} in {{fiscal_year}}',
      },
    });

    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(expect.objectContaining({
      donor_count: 1,
      warnings: expect.any(Array),
      html: expect.stringContaining(fixture.contact.name),
    }));
    expect(preview.body.html).toContain(fixture.contact.donor_id);
    expect(preview.body.html).toContain('$40.00');
    expect(preview.body.html).toContain(String(fixture.fiscalYear));
  });

  it('rejects invalid donation receipt account ids before building receipts', async () => {
    const rejected = await requestRoute({
      probePath: '/preview',
      method: 'POST',
      body: {
        fiscal_year: Number(todayDateOnly().slice(0, 4)),
        account_ids: [999999999],
        html_body: 'Donor {{donor_name}}',
      },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'Selected account IDs are not income accounts: 999999999' });
  });
});

interface TemplateRowSnapshot {
  id: number;
  markdown_body: string | null;
  html_body: string | null;
  updated_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

async function snapshotTemplateRow(): Promise<TemplateRowSnapshot | undefined> {
  return await db('donation_receipt_templates').orderBy('id', 'asc').first() as TemplateRowSnapshot | undefined;
}

async function setTemplateRow(partial: Partial<TemplateRowSnapshot>) {
  const row = await snapshotTemplateRow();
  if (row) {
    await db('donation_receipt_templates').where({ id: row.id }).update(partial);
  } else {
    await db('donation_receipt_templates').insert({
      markdown_body: null,
      html_body: null,
      ...partial,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }
}

async function restoreTemplateRow(snapshot: TemplateRowSnapshot | undefined) {
  if (snapshot) {
    await db('donation_receipt_templates').where({ id: snapshot.id }).update({
      markdown_body: snapshot.markdown_body,
      html_body: snapshot.html_body,
      updated_by: snapshot.updated_by,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    });
  } else {
    await db('donation_receipt_templates').del();
  }
}

const LEGACY_MARKDOWN = `# Legacy Title

**Bold {{donor_name}}**

:::center
Centered line
:::

[details](https://example.com/{{church_phone}})`;

describe('direct DB donation-receipt template lazy conversion', () => {
  let templateSnapshot: TemplateRowSnapshot | undefined;

  beforeEach(async () => {
    templateSnapshot = await snapshotTemplateRow();
    await setTemplateRow({ markdown_body: LEGACY_MARKDOWN, html_body: null });
  });

  afterEach(async () => {
    await restoreTemplateRow(templateSnapshot);
  });

  it('converts and persists canonical HTML on first read, preserving legacy markdown', async () => {
    const template = await requestRoute({ probePath: '/template', method: 'GET' });

    expect(template.status).toBe(200);
    const htmlBody = template.body.template.html_body as string;
    expect(htmlBody).toContain('<h1>Legacy Title</h1>');
    expect(htmlBody).toContain('Bold {{donor_name}}');
    expect(htmlBody).toContain('text-align:center');
    expect(htmlBody).toContain('Centered line');
    // Legacy link with attribute placeholder is unwrapped and its templated
    // URL becomes visible text.
    expect(htmlBody).toContain('details');
    expect(htmlBody).toContain('(https://example.com/{{church_phone}})');
    expect(htmlBody).not.toContain('<a href');

    const row = await snapshotTemplateRow();
    expect(row?.html_body).toBe(htmlBody);
    expect(row?.markdown_body).toBe(LEGACY_MARKDOWN);
  });

  it('returns a saved html_body without running conversion', async () => {
    // A template saved by another writer (e.g. during the lazy-conversion
    // race) is served as-is. The conditional-update/refetch path itself is
    // unit-tested in services/__tests__/donationReceipts.test.ts, because the
    // read → save → update interleaving cannot be forced through the HTTP layer.
    await setTemplateRow({ markdown_body: LEGACY_MARKDOWN, html_body: '<p>Concurrent save</p>' });

    const template = await requestRoute({ probePath: '/template', method: 'GET' });

    expect(template.status).toBe(200);
    expect(template.body.template.html_body).toBe('<p>Concurrent save</p>');

    const row = await snapshotTemplateRow();
    expect(row?.html_body).toBe('<p>Concurrent save</p>');
    expect(row?.markdown_body).toBe(LEGACY_MARKDOWN);
  });

  it('falls back to the default template when converted legacy content is unusable', async () => {
    await setTemplateRow({ markdown_body: '<script>alert(1)</script>', html_body: null });

    const template = await requestRoute({ probePath: '/template', method: 'GET' });

    expect(template.status).toBe(200);
    expect(template.body.template.html_body).toContain('Official Receipt for Income Tax Purposes');

    const row = await snapshotTemplateRow();
    expect(row?.html_body).toContain('Official Receipt for Income Tax Purposes');
  });

  it('saves canonical HTML and keeps legacy markdown for rollback', async () => {
    const saved = await requestRoute({
      probePath: '/template',
      method: 'PUT',
      role: 'admin',
      body: { html_body: '<p>New {{donor_name}}</p><script>alert(1)</script>' },
    });

    expect(saved.status).toBe(200);
    expect(saved.body.template.html_body).toBe('<p>New {{donor_name}}</p>');

    const row = await snapshotTemplateRow();
    expect(row?.html_body).toBe('<p>New {{donor_name}}</p>');
    expect(row?.markdown_body).toBe(LEGACY_MARKDOWN);
  });

  it('rejects unknown variables on save', async () => {
    const rejected = await requestRoute({
      probePath: '/template',
      method: 'PUT',
      role: 'admin',
      body: { html_body: '<p>{{bogus}}</p>' },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'Unknown template variables: bogus' });
  });

  it('rejects placeholders inside attributes and empty-after-sanitization content on save', async () => {
    const attrRejected = await requestRoute({
      probePath: '/template',
      method: 'PUT',
      role: 'admin',
      body: { html_body: '<a href="{{donor_id}}">x</a>' },
    });
    expect(attrRejected.status).toBe(400);
    expect(attrRejected.body.error).toContain('not allowed inside HTML attributes');

    const emptyRejected = await requestRoute({
      probePath: '/template',
      method: 'PUT',
      role: 'admin',
      body: { html_body: '<script>alert(1)</script>' },
    });
    expect(emptyRejected.status).toBe(400);
    expect(emptyRejected.body.error).toContain('empty after sanitization');
  });
});
