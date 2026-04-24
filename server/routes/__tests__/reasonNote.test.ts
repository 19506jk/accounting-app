import dotenv from 'dotenv';
import type { Router } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';

import { requestMountedRoute } from '../routeTestHelpers.js';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

let billsRouter: Router;
let reconciliationRouter: Router;
let fiscalPeriodsRouter: Router;

beforeAll(async () => {
  const [billsModule, reconciliationModule, fiscalPeriodsModule] = await Promise.all([
    import('../bills.js'),
    import('../reconciliation.js'),
    import('../fiscalPeriods.js'),
  ]);

  billsRouter = billsModule.default as unknown as Router;
  reconciliationRouter = reconciliationModule.default as unknown as Router;
  fiscalPeriodsRouter = fiscalPeriodsModule.default as unknown as Router;
});

describe('reason_note route validation', () => {
  it('rejects void bill requests with missing reason_note', async () => {
    const response = await requestMountedRoute({
      mountPath: '/api/bills',
      probePath: '/1/void',
      method: 'POST',
      router: billsRouter,
      role: 'admin',
      body: {},
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: ['reason_note is required for this operation'],
    });
  });

  it('rejects unapply bill credits requests with blank reason_note', async () => {
    const response = await requestMountedRoute({
      mountPath: '/api/bills',
      probePath: '/1/unapply-credits',
      method: 'POST',
      router: billsRouter,
      role: 'editor',
      body: { reason_note: '   ' },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: ['reason_note is required for this operation'],
    });
  });

  it('rejects reconciliation reopen requests with missing reason_note', async () => {
    const response = await requestMountedRoute({
      mountPath: '/api/reconciliations',
      probePath: '/1/reopen',
      method: 'POST',
      router: reconciliationRouter,
      role: 'admin',
      body: {},
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'reason_note is required for this operation',
    });
  });

  it('rejects fiscal period reopen requests with blank reason_note', async () => {
    const response = await requestMountedRoute({
      mountPath: '/api/fiscal-periods',
      probePath: '/1/reopen',
      method: 'DELETE',
      router: fiscalPeriodsRouter,
      role: 'admin',
      body: { reason_note: '' },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'reason_note is required for this operation',
    });
  });
});
