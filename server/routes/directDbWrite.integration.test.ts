import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ override: true });

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];

let accountsRouter: express.Router;
let fundsRouter: express.Router;

beforeAll(async () => {
  await db.raw('select 1');

  const [accountsModule, fundsModule] = await Promise.all([
    import('./accounts.js'),
    import('./funds.js'),
  ]);

  accountsRouter = accountsModule.default as unknown as express.Router;
  fundsRouter = fundsModule.default as unknown as express.Router;
});

afterEach(async () => {
  if (createdFundIds.length > 0) {
    await db('funds').whereIn('id', createdFundIds).delete();
    createdFundIds.length = 0;
  }

  if (createdAccountIds.length > 0) {
    await db('accounts').whereIn('id', createdAccountIds).delete();
    createdAccountIds.length = 0;
  }
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
  method: 'POST' | 'DELETE';
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

describe('direct DB route write integration smoke checks', () => {
  it('creates an account using the development database', async () => {
    const suffix = uniqueSuffix();
    const payload = {
      code: `ITA-${suffix}`,
      name: `Integration Account ${suffix}`,
      type: 'EXPENSE',
    };

    const res = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: payload,
    });

    expect(res.status).toBe(201);
    expect(res.body.account).toEqual(expect.objectContaining({
      id: expect.any(Number),
      code: payload.code,
      name: payload.name,
      type: 'EXPENSE',
      is_active: true,
    }));

    createdAccountIds.push(res.body.account.id);
  });

  it('creates a fund and linked equity account using the development database', async () => {
    const suffix = uniqueSuffix();
    const payload = {
      name: `Integration Fund ${suffix}`,
      description: 'Integration test temporary fund',
      code: `ITF-${suffix}`,
    };

    const res = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'editor',
      body: payload,
    });

    expect(res.status).toBe(201);
    expect(res.body.fund).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: payload.name,
      description: payload.description,
      is_active: true,
      net_asset_account_id: expect.any(Number),
    }));
    expect(res.body.equityAccount).toEqual(expect.objectContaining({
      id: expect.any(Number),
      code: payload.code,
      type: 'EQUITY',
      is_active: true,
    }));

    createdFundIds.push(res.body.fund.id);
    createdAccountIds.push(res.body.equityAccount.id);
  });

  it('deactivates an account through delete route when no transaction history exists', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      code: `ITD-A-${suffix}`,
      name: `Delete Account ${suffix}`,
      type: 'EXPENSE',
    };

    const created = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: createPayload,
    });

    expect(created.status).toBe(201);
    const accountId = created.body.account.id as number;
    createdAccountIds.push(accountId);

    const deleted = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${accountId}`,
      method: 'DELETE',
      router: accountsRouter,
      role: 'admin',
    });

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: 'Account deactivated successfully' });

    const stored = await db('accounts').where({ id: accountId }).first() as { is_active: boolean } | undefined;
    expect(stored?.is_active).toBe(false);
  });

  it('deactivates a fund through delete route when balance and transaction history are zero', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      name: `Delete Fund ${suffix}`,
      description: 'Integration delete test fund',
      code: `ITD-F-${suffix}`,
    };

    const created = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: createPayload,
    });

    expect(created.status).toBe(201);
    const fundId = created.body.fund.id as number;
    const equityAccountId = created.body.equityAccount.id as number;
    createdFundIds.push(fundId);
    createdAccountIds.push(equityAccountId);

    const deleted = await requestRoute({
      mountPath: '/api/funds',
      probePath: `/${fundId}`,
      method: 'DELETE',
      router: fundsRouter,
      role: 'admin',
    });

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: 'Fund deactivated successfully' });

    const stored = await db('funds').where({ id: fundId }).first() as { is_active: boolean } | undefined;
    expect(stored?.is_active).toBe(false);
  });
});
