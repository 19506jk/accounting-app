import dotenv from 'dotenv';
import type { Router } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { requestMountedRoute } from './routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../db') as Knex;

let fiscalPeriodsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const fiscalPeriodsModule = await import('./fiscalPeriods.js');
  fiscalPeriodsRouter = fiscalPeriodsModule.default as unknown as Router;
});

async function requestRoute({
  probePath,
  method,
  role = 'admin',
  body,
}: {
  probePath: string;
  method: 'GET' | 'POST';
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/fiscal-periods',
    probePath,
    method,
    router: fiscalPeriodsRouter,
    role,
    body,
  });
}

describe('direct DB fiscal-periods integration smoke checks', () => {
  it('lists fiscal periods from the development database', async () => {
    const response = await requestRoute({
      probePath: '/',
      method: 'GET',
      role: 'admin',
    });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.fiscal_periods)).toBe(true);

    if (response.body.fiscal_periods.length > 0) {
      expect(response.body.fiscal_periods[0]).toEqual(expect.objectContaining({
        id: expect.any(Number),
        fiscal_year: expect.any(Number),
        period_start: expect.any(String),
        period_end: expect.any(String),
        status: 'HARD_CLOSED',
      }));
    }
  });

  it('investigates the next hard close window without mutating fiscal periods', async () => {
    const beforeCount = await db('fiscal_periods').count('id as count').first() as { count: string } | undefined;

    const response = await requestRoute({
      probePath: '/investigate',
      method: 'POST',
      role: 'admin',
    });

    expect([200, 409]).toContain(response.status);

    if (response.status === 200) {
      expect(response.body).toEqual(expect.objectContaining({
        fiscal_year: expect.any(Number),
        period_start: expect.any(String),
        period_end: expect.any(String),
        pro_forma_lines: expect.any(Array),
        preflight: expect.objectContaining({
          trial_balance_plugs: expect.any(Boolean),
          per_fund_balanced: expect.any(Boolean),
          all_asset_accounts_reconciled: expect.any(Boolean),
          no_unmapped_funds: expect.any(Boolean),
        }),
      }));
    } else {
      expect(response.body).toEqual({ error: 'No closable prior year found.' });
    }

    const afterCount = await db('fiscal_periods').count('id as count').first() as { count: string } | undefined;
    expect(afterCount?.count).toBe(beforeCount?.count);
  });
});
