import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ override: true });

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

const createdContactIds: number[] = [];
const settingsRestores: Array<{ key: string; value: string | null }> = [];

let contactsRouter: express.Router;
let settingsRouter: express.Router;

beforeAll(async () => {
  await db.raw('select 1');

  const [contactsModule, settingsModule] = await Promise.all([
    import('./contacts.js'),
    import('./settings.js'),
  ]);

  contactsRouter = contactsModule.default as unknown as express.Router;
  settingsRouter = settingsModule.default as unknown as express.Router;
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

afterAll(async () => {
  await db.destroy();
});

function buildToken(role: 'admin' | 'editor' | 'viewer' = 'admin') {
  return jwt.sign(
    { id: 1, email: `${role}@example.com`, role },
    process.env.JWT_SECRET || 'jwt-secret',
  );
}

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
  method: 'POST' | 'PUT' | 'DELETE';
  router: express.Router;
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}${mountPath}${probePath}`, {
    method,
    headers: {
      authorization: `Bearer ${buildToken(role)}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));

  return { status: response.status, body: json };
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
});
