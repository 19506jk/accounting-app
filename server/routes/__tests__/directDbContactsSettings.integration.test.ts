import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdContactIds: number[] = [];
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
  if (createdContactIds.length > 0) {
    await db('contacts').whereIn('id', createdContactIds).delete();
    createdContactIds.length = 0;
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
