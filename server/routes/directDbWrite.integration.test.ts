import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from './routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];

let accountsRouter: Router;
let fundsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const [accountsModule, fundsModule] = await Promise.all([
    import('./accounts.js'),
    import('./funds.js'),
  ]);

  accountsRouter = accountsModule.default as unknown as Router;
  fundsRouter = fundsModule.default as unknown as Router;
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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
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

  it('updates an account and reads it back by id using the development database', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      code: `ITU-A-${suffix}`,
      name: `Update Account ${suffix}`,
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

    const updatePayload = {
      code: `ITU-A2-${suffix}`,
      name: `Updated Account ${suffix}`,
      type: 'EXPENSE',
      is_active: false,
    };

    const updated = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${accountId}`,
      method: 'PUT',
      router: accountsRouter,
      role: 'editor',
      body: updatePayload,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.account).toEqual(expect.objectContaining({
      id: accountId,
      code: updatePayload.code,
      name: updatePayload.name,
      type: 'EXPENSE',
      is_active: false,
    }));

    const found = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${accountId}`,
      method: 'GET',
      router: accountsRouter,
      role: 'viewer',
    });

    expect(found.status).toBe(200);
    expect(found.body.account).toEqual(expect.objectContaining({
      id: accountId,
      code: updatePayload.code,
      name: updatePayload.name,
      is_active: false,
    }));
  });

  it('updates a fund and linked equity account using the development database', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      name: `Update Fund ${suffix}`,
      description: 'Integration update test fund',
      code: `ITU-F-${suffix}`,
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

    const updatePayload = {
      name: `Updated Fund ${suffix}`,
      description: 'Updated integration fund description',
      code: `ITU-F2-${suffix}`,
      is_active: false,
    };

    const updated = await requestRoute({
      mountPath: '/api/funds',
      probePath: `/${fundId}`,
      method: 'PUT',
      router: fundsRouter,
      role: 'editor',
      body: updatePayload,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.fund).toEqual(expect.objectContaining({
      id: fundId,
      name: updatePayload.name,
      description: updatePayload.description,
      is_active: false,
      net_asset_account_id: equityAccountId,
    }));

    const linkedAccount = await db('accounts').where({ id: equityAccountId }).first() as {
      code: string;
      name: string;
      is_active: boolean;
    } | undefined;
    expect(linkedAccount).toEqual(expect.objectContaining({
      code: updatePayload.code,
      name: `${updatePayload.name} - Net Assets`,
      is_active: false,
    }));

    const found = await requestRoute({
      mountPath: '/api/funds',
      probePath: `/${fundId}`,
      method: 'GET',
      router: fundsRouter,
      role: 'viewer',
    });

    expect(found.status).toBe(200);
    expect(found.body.fund).toEqual(expect.objectContaining({
      id: fundId,
      name: updatePayload.name,
      net_asset_code: updatePayload.code,
      net_asset_name: `${updatePayload.name} - Net Assets`,
    }));
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

  it('rejects account create when required fields are missing', async () => {
    const rejected = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {},
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'code, name, and type are required' });
  });

  it('rejects duplicate account codes before inserting another account', async () => {
    const suffix = uniqueSuffix();
    const payload = {
      code: `ITDUP-${suffix}`,
      name: `Duplicate Account ${suffix}`,
      type: 'EXPENSE',
    };

    const created = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: payload,
    });

    expect(created.status).toBe(201);
    createdAccountIds.push(created.body.account.id);

    const duplicate = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {
        ...payload,
        name: `Duplicate Account Retry ${suffix}`,
      },
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: `Account code ${payload.code} already exists` });

    const rows = await db('accounts').where({ code: payload.code });
    expect(rows).toHaveLength(1);
  });

  it('rejects fund create when required fields are missing', async () => {
    const rejected = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: { code: `ITF-${uniqueSuffix()}` },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'Fund name is required' });
  });

  it('rejects non-admin users before deleting an account', async () => {
    const forbidden = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/999999999',
      method: 'DELETE',
      router: accountsRouter,
      role: 'editor',
    });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: 'Access denied — requires role: admin' });
  });
});
