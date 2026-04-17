import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ override: true });

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

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

afterAll(async () => {
  await db.destroy();
});

function buildToken(role: 'admin' | 'editor' | 'viewer' = 'viewer') {
  return jwt.sign(
    { id: 1, email: `${role}@example.com`, role },
    process.env.JWT_SECRET || 'jwt-secret',
  );
}

async function requestRoute({
  mountPath,
  probePath,
  router,
}: {
  mountPath: string;
  probePath: string;
  router: express.Router;
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
    headers: {
      authorization: `Bearer ${buildToken()}`,
    },
  });
  const json = await response.json();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));

  return { status: response.status, body: json };
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
});
