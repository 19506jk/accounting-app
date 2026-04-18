import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';


dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

type TaxRateRestore = {
  id: number;
  rate: string | number;
  is_active: boolean;
};

const taxRateRestores: TaxRateRestore[] = [];

let taxRatesRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const taxRatesModule = await import('../taxRates.js');
  taxRatesRouter = taxRatesModule.default as unknown as Router;
});

afterEach(async () => {
  for (const restore of taxRateRestores) {
    await db('tax_rates')
      .where({ id: restore.id })
      .update({
        rate: restore.rate,
        is_active: restore.is_active,
        updated_at: db.fn.now(),
      });
  }
  taxRateRestores.length = 0;
});

async function requestRoute({
  probePath,
  method,
  role = 'admin',
  body,
}: {
  probePath: string;
  method: 'GET' | 'PUT' | 'PATCH';
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath: '/api/tax-rates',
    probePath,
    method,
    router: taxRatesRouter,
    role,
    body,
  });
}

async function loadTaxRate() {
  const taxRate = await db('tax_rates')
    .orderBy('id', 'asc')
    .first() as TaxRateRestore | undefined;

  expect(taxRate).toBeDefined();
  if (!taxRate) throw new Error('Expected at least one tax rate in development database');

  taxRateRestores.push({
    id: taxRate.id,
    rate: taxRate.rate,
    is_active: taxRate.is_active,
  });

  return taxRate;
}

describe('direct DB tax-rates integration smoke checks', () => {
  it('lists tax rates from the development database', async () => {
    const taxRate = await loadTaxRate();

    const listed = await requestRoute({
      probePath: '/?all=true',
      method: 'GET',
      role: 'viewer',
    });

    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.tax_rates)).toBe(true);
    expect(listed.body.tax_rates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: taxRate.id,
        rate: Number(taxRate.rate),
        rebate_percentage: expect.any(Number),
        is_active: taxRate.is_active,
      }),
    ]));
  });

  it('omits inactive tax rates from the default list', async () => {
    const taxRate = await loadTaxRate();

    await db('tax_rates')
      .where({ id: taxRate.id })
      .update({ is_active: false, updated_at: db.fn.now() });

    const listed = await requestRoute({
      probePath: '/',
      method: 'GET',
      role: 'viewer',
    });

    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.tax_rates)).toBe(true);
    expect(listed.body.tax_rates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: taxRate.id }),
    ]));
  });

  it('updates an existing tax rate and restores it after the test', async () => {
    const taxRate = await loadTaxRate();
    const nextRate = String(taxRate.rate) === '0.1234' ? 0.1111 : 0.1234;

    const updated = await requestRoute({
      probePath: `/${taxRate.id}`,
      method: 'PUT',
      role: 'admin',
      body: { rate: nextRate },
    });

    expect(updated.status).toBe(200);
    expect(updated.body.tax_rate).toEqual(expect.objectContaining({
      id: taxRate.id,
      rate: nextRate,
    }));

    const stored = await db('tax_rates')
      .where({ id: taxRate.id })
      .first() as { rate: string | number } | undefined;
    expect(Number(stored?.rate)).toBe(nextRate);
  });

  it('toggles an existing tax rate and restores it after the test', async () => {
    const taxRate = await loadTaxRate();

    const toggled = await requestRoute({
      probePath: `/${taxRate.id}/toggle`,
      method: 'PATCH',
      role: 'admin',
    });

    expect(toggled.status).toBe(200);
    expect(toggled.body.tax_rate).toEqual(expect.objectContaining({
      id: taxRate.id,
      is_active: !taxRate.is_active,
    }));

    const stored = await db('tax_rates')
      .where({ id: taxRate.id })
      .first() as { is_active: boolean } | undefined;
    expect(stored?.is_active).toBe(!taxRate.is_active);
  });

  it('rejects an invalid tax rate update before mutating the database', async () => {
    const taxRate = await loadTaxRate();

    const rejected = await requestRoute({
      probePath: `/${taxRate.id}`,
      method: 'PUT',
      role: 'admin',
      body: { rate: 1 },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ errors: ['rate must be between 0 and 1 (e.g. 0.13 for 13%)'] });

    const stored = await db('tax_rates')
      .where({ id: taxRate.id })
      .first() as { rate: string | number } | undefined;
    expect(String(stored?.rate)).toBe(String(taxRate.rate));
  });

  it('returns 404 when updating a missing tax rate', async () => {
    const missing = await requestRoute({
      probePath: '/999999999',
      method: 'PUT',
      role: 'admin',
      body: { rate: 0.1234 },
    });

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Tax rate not found' });
  });

  it('rejects non-admin users before updating a tax rate', async () => {
    const taxRate = await loadTaxRate();

    const forbidden = await requestRoute({
      probePath: `/${taxRate.id}`,
      method: 'PUT',
      role: 'editor',
      body: { rate: 0.1234 },
    });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: 'Access denied — requires role: admin' });

    const stored = await db('tax_rates')
      .where({ id: taxRate.id })
      .first() as { rate: string | number } | undefined;
    expect(String(stored?.rate)).toBe(String(taxRate.rate));
  });
});
