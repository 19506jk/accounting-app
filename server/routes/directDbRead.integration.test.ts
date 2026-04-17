import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from './routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

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

async function requestRoute({
  mountPath,
  probePath,
  router,
}: {
  mountPath: string;
  probePath: string;
  router: Router;
}) {
  return requestMountedRoute({ mountPath, probePath, router, role: 'viewer' });
}

describe('direct DB route read integration smoke checks', () => {
  it('returns accounts from the development database', async () => {
    const res = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      router: accountsRouter,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);

    if (res.body.accounts.length > 0) {
      expect(res.body.accounts[0]).toEqual(expect.objectContaining({
        id: expect.any(Number),
        code: expect.any(String),
        name: expect.any(String),
        type: expect.any(String),
        is_active: expect.any(Boolean),
      }));
    }
  });

  it('filters accounts by type using the development database', async () => {
    const account = await db('accounts')
      .where({ is_active: true })
      .orderBy('id', 'asc')
      .first() as { id: number; type: string } | undefined;

    expect(account).toBeDefined();
    if (!account) return;

    const res = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/?type=${account.type}`,
      router: accountsRouter,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: account.id,
        type: account.type,
        is_active: true,
      }),
    ]));
    expect(res.body.accounts.every((row: { type: string }) => row.type === account.type)).toBe(true);
  });

  it('rejects invalid account type filters before reading accounts', async () => {
    const res = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/?type=not-a-type',
      router: accountsRouter,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid type. Must be one of: ASSET, LIABILITY, EQUITY, INCOME, EXPENSE' });
  });

  it('returns funds from the development database', async () => {
    const res = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      router: fundsRouter,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.funds)).toBe(true);

    if (res.body.funds.length > 0) {
      expect(res.body.funds[0]).toEqual(expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        is_active: expect.any(Boolean),
      }));
    }
  });

  it('returns 404 when reading a missing fund', async () => {
    const res = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/999999999',
      router: fundsRouter,
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Fund not found' });
  });
});
