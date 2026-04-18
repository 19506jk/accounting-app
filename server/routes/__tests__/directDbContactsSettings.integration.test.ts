import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';


dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdTransactionIds: number[] = [];
const createdContactIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];
const settingsRestores: Array<{ key: string; value: string | null }> = [];

let contactsRouter: Router;
let settingsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const [contactsModule, settingsModule] = await Promise.all([
    import('../contacts.js'),
    import('../settings.js'),
  ]);

  contactsRouter = contactsModule.default as unknown as Router;
  settingsRouter = settingsModule.default as unknown as Router;
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

  for (const restore of settingsRestores) {
    await db('settings')
      .where({ key: restore.key })
      .update({ value: restore.value, updated_at: db.fn.now() });
  }
  settingsRestores.length = 0;
});

async function requestRoute({
  mountPath,
  probePath,
  method,
  router,
  role = 'admin',
  body,
}: {
  mountPath: string;
  probePath: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  router: Router;
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath,
    probePath,
    method,
    router,
    role,
    body,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function createContactDonationFixture() {
  const suffix = uniqueSuffix();

  const created = await requestRoute({
    mountPath: '/api/contacts',
    probePath: '/',
    method: 'POST',
    router: contactsRouter,
    role: 'admin',
    body: {
      type: 'DONOR',
      contact_class: 'INDIVIDUAL',
      name: `Linked Donation Contact ${suffix}`,
      donor_id: `LD-${suffix}`,
    },
  });
  expect(created.status).toBe(201);
  const contactId = created.body.contact.id as number;
  createdContactIds.push(contactId);

  const [bankAccount] = await db('accounts')
    .insert({
      code: `LDB-${suffix}`,
      name: `Linked Donation Bank ${suffix}`,
      type: 'ASSET',
      account_class: 'ASSET',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [incomeAccount] = await db('accounts')
    .insert({
      code: `LDI-${suffix}`,
      name: `Linked Donation Income ${suffix}`,
      type: 'INCOME',
      account_class: 'INCOME',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  const [equityAccount] = await db('accounts')
    .insert({
      code: `LDE-${suffix}`,
      name: `Linked Donation Equity ${suffix}`,
      type: 'EQUITY',
      account_class: 'EQUITY',
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!bankAccount || !incomeAccount || !equityAccount) throw new Error('Failed to create linked contact accounts');
  createdAccountIds.push(bankAccount.id, incomeAccount.id, equityAccount.id);

  const [fund] = await db('funds')
    .insert({
      name: `Linked Donation Fund ${suffix}`,
      description: 'Linked contact delete fixture fund',
      net_asset_account_id: equityAccount.id,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!fund) throw new Error('Failed to create linked contact fund');
  createdFundIds.push(fund.id);

  const [transaction] = await db('transactions')
    .insert({
      date: '2026-04-04',
      description: `Linked Donation ${suffix}`,
      reference_no: null,
      fund_id: fund.id,
      created_by: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create linked contact transaction');
  createdTransactionIds.push(transaction.id);

  await db('journal_entries').insert([
    {
      transaction_id: transaction.id,
      account_id: bankAccount.id,
      fund_id: fund.id,
      contact_id: null,
      debit: '30.00',
      credit: '0.00',
      memo: 'Linked deposit',
      is_reconciled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      transaction_id: transaction.id,
      account_id: incomeAccount.id,
      fund_id: fund.id,
      contact_id: contactId,
      debit: '0.00',
      credit: '30.00',
      memo: 'Linked income',
      is_reconciled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  return { contactId };
}

describe('direct DB contacts/settings integration smoke checks', () => {
  it('creates and deletes a contact against development database', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      type: 'PAYEE',
      contact_class: 'INDIVIDUAL',
      name: `Integration Contact ${suffix}`,
      email: `contact-${suffix}@example.com`,
    };

    const created = await requestRoute({
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      router: contactsRouter,
      role: 'admin',
      body: createPayload,
    });

    expect(created.status).toBe(201);
    expect(created.body.contact).toEqual(expect.objectContaining({
      id: expect.any(Number),
      type: 'PAYEE',
      contact_class: 'INDIVIDUAL',
      name: createPayload.name,
      is_active: true,
    }));

    const contactId = created.body.contact.id as number;
    createdContactIds.push(contactId);

    const deleted = await requestRoute({
      mountPath: '/api/contacts',
      probePath: `/${contactId}`,
      method: 'DELETE',
      router: contactsRouter,
      role: 'admin',
    });

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: 'Contact deleted successfully' });
  });

  it('updates a contact and reads it back by id using the development database', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      type: 'PAYEE',
      contact_class: 'INDIVIDUAL',
      name: `Update Contact ${suffix}`,
      email: `update-contact-${suffix}@example.com`,
    };

    const created = await requestRoute({
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      router: contactsRouter,
      role: 'admin',
      body: createPayload,
    });

    expect(created.status).toBe(201);
    const contactId = created.body.contact.id as number;
    createdContactIds.push(contactId);

    const updatePayload = {
      name: `Updated Contact ${suffix}`,
      email: `updated-contact-${suffix}@example.com`,
      province: 'on',
      postal_code: 'k1a0b1',
      is_active: false,
    };

    const updated = await requestRoute({
      mountPath: '/api/contacts',
      probePath: `/${contactId}`,
      method: 'PUT',
      router: contactsRouter,
      role: 'editor',
      body: updatePayload,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.contact).toEqual(expect.objectContaining({
      id: contactId,
      name: updatePayload.name,
      email: updatePayload.email,
      province: 'ON',
      postal_code: 'K1A 0B1',
      is_active: false,
    }));

    const found = await requestRoute({
      mountPath: '/api/contacts',
      probePath: `/${contactId}`,
      method: 'GET',
      router: contactsRouter,
      role: 'viewer',
    });

    expect(found.status).toBe(200);
    expect(found.body.contact).toEqual(expect.objectContaining({
      id: contactId,
      name: updatePayload.name,
      email: updatePayload.email,
      province: 'ON',
      postal_code: 'K1A 0B1',
      is_active: false,
    }));
  });

  it('normalises six-character, non-standard, and null postal codes through contact writes', async () => {
    const suffix = uniqueSuffix();
    const sixCharacter = await requestRoute({
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      router: contactsRouter,
      role: 'admin',
      body: {
        type: 'PAYEE',
        contact_class: 'INDIVIDUAL',
        name: `Six Character Postal Contact ${suffix}`,
        postal_code: 'a1b2c3',
      },
    });

    expect(sixCharacter.status).toBe(201);
    const sixCharacterId = sixCharacter.body.contact.id as number;
    createdContactIds.push(sixCharacterId);
    expect(sixCharacter.body.contact).toEqual(expect.objectContaining({
      id: sixCharacterId,
      postal_code: 'A1B 2C3',
    }));

    const nonStandard = await requestRoute({
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      router: contactsRouter,
      role: 'admin',
      body: {
        type: 'PAYEE',
        contact_class: 'INDIVIDUAL',
        name: `Postal Contact ${suffix}`,
        postal_code: ' abc ',
      },
    });

    expect(nonStandard.status).toBe(201);
    const nonStandardId = nonStandard.body.contact.id as number;
    createdContactIds.push(nonStandardId);
    expect(nonStandard.body.contact).toEqual(expect.objectContaining({
      id: nonStandardId,
      postal_code: 'ABC',
    }));

    const nullPostal = await requestRoute({
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      router: contactsRouter,
      role: 'admin',
      body: {
        type: 'PAYEE',
        contact_class: 'INDIVIDUAL',
        name: `Null Postal Contact ${suffix}`,
        postal_code: null,
      },
    });

    expect(nullPostal.status).toBe(201);
    const nullPostalId = nullPostal.body.contact.id as number;
    createdContactIds.push(nullPostalId);
    expect(nullPostal.body.contact).toEqual(expect.objectContaining({
      id: nullPostalId,
      postal_code: null,
    }));
  });

  it('lists contacts by search using the development database', async () => {
    const suffix = uniqueSuffix();
    const name = `Search Contact ${suffix}`;

    const created = await requestRoute({
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      router: contactsRouter,
      role: 'admin',
      body: {
        type: 'PAYEE',
        contact_class: 'INDIVIDUAL',
        name,
        email: `search-contact-${suffix}@example.com`,
      },
    });

    expect(created.status).toBe(201);
    const contactId = created.body.contact.id as number;
    createdContactIds.push(contactId);

    const listed = await requestRoute({
      mountPath: '/api/contacts',
      probePath: `/?search=${encodeURIComponent(suffix)}`,
      method: 'GET',
      router: contactsRouter,
      role: 'viewer',
    });

    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.contacts)).toBe(true);
    expect(listed.body.contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: contactId,
        name,
        is_active: true,
      }),
    ]));
  });

  it('deactivates a contact using the development database', async () => {
    const suffix = uniqueSuffix();
    const created = await requestRoute({
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      router: contactsRouter,
      role: 'admin',
      body: {
        type: 'PAYEE',
        contact_class: 'INDIVIDUAL',
        name: `Deactivate Contact ${suffix}`,
      },
    });

    expect(created.status).toBe(201);
    const contactId = created.body.contact.id as number;
    createdContactIds.push(contactId);

    const deactivated = await requestRoute({
      mountPath: '/api/contacts',
      probePath: `/${contactId}/deactivate`,
      method: 'PATCH',
      router: contactsRouter,
      role: 'editor',
    });

    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toEqual({ message: 'Contact deactivated successfully' });

    const stored = await db('contacts').where({ id: contactId }).first() as { is_active: boolean } | undefined;
    expect(stored?.is_active).toBe(false);
  });

  it('rejects deleting a contact linked to journal entries with the route pre-count response', async () => {
    const fixture = await createContactDonationFixture();

    const deleted = await requestRoute({
      mountPath: '/api/contacts',
      probePath: `/${fixture.contactId}`,
      method: 'DELETE',
      router: contactsRouter,
      role: 'admin',
    });

    expect(deleted.status).toBe(409);
    expect(deleted.body).toEqual({
      error: 'Cannot delete — contact is linked to transactions.',
    });
  });

  it('updates settings and restores original value after test', async () => {
    const original = await db('settings')
      .whereNot({ key: 'church_timezone' })
      .orderBy('id', 'asc')
      .first() as { key: string; value: string | null } | undefined;

    expect(original).toBeDefined();
    if (!original) return;

    settingsRestores.push({ key: original.key, value: original.value });

    const nextValue = `integration-${uniqueSuffix()}`;
    const updated = await requestRoute({
      mountPath: '/api/settings',
      probePath: '/',
      method: 'PUT',
      router: settingsRouter,
      role: 'admin',
      body: { [original.key]: nextValue },
    });

    expect(updated.status).toBe(200);
    expect(updated.body.values?.[original.key]).toBe(nextValue);

    const stored = await db('settings')
      .where({ key: original.key })
      .first() as { value: string | null } | undefined;
    expect(stored?.value).toBe(nextValue);
  });

  it('returns settings values from the development database', async () => {
    const response = await requestRoute({
      mountPath: '/api/settings',
      probePath: '/',
      method: 'GET',
      router: settingsRouter,
      role: 'viewer',
    });

    expect(response.status).toBe(200);
    expect(response.body.values).toEqual(expect.any(Object));
    expect(response.body.values).toHaveProperty('church_timezone');
    expect(Array.isArray(response.body.settings)).toBe(true);
  });

  it('rejects donor contact creation when donor_id is missing', async () => {
    const rejected = await requestRoute({
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      router: contactsRouter,
      role: 'admin',
      body: {
        type: 'DONOR',
        contact_class: 'INDIVIDUAL',
        name: `Invalid Donor ${uniqueSuffix()}`,
      },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ errors: ['donor_id is required for contacts of type DONOR or BOTH'] });
  });

  it('rejects invalid church timezone setting before mutating settings', async () => {
    const original = await db('settings')
      .where({ key: 'church_timezone' })
      .first() as { value: string | null } | undefined;

    const rejected = await requestRoute({
      mountPath: '/api/settings',
      probePath: '/',
      method: 'PUT',
      router: settingsRouter,
      role: 'admin',
      body: { church_timezone: 'Not/A_TimeZone' },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'church_timezone must be a valid IANA timezone (e.g., America/Toronto)' });

    const stored = await db('settings')
      .where({ key: 'church_timezone' })
      .first() as { value: string | null } | undefined;
    expect(stored?.value).toBe(original?.value);
  });

  it('rejects non-object settings updates before reading setting keys', async () => {
    const rejected = await requestRoute({
      mountPath: '/api/settings',
      probePath: '/',
      method: 'PUT',
      router: settingsRouter,
      role: 'admin',
      body: [],
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'Request body must be a key-value object' });
  });

  it('rejects non-admin users before updating settings', async () => {
    const rejected = await requestRoute({
      mountPath: '/api/settings',
      probePath: '/',
      method: 'PUT',
      router: settingsRouter,
      role: 'editor',
      body: { church_name: `blocked-${uniqueSuffix()}` },
    });

    expect(rejected.status).toBe(403);
    expect(rejected.body).toEqual({ error: 'Access denied — requires role: admin' });
  });
});
