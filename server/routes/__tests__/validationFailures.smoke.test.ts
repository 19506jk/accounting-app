import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DB_NAME = process.env.DB_NAME || 'test_db';
process.env.DB_USER = process.env.DB_USER || 'test_user';
process.env.DB_PASS = process.env.DB_PASS || 'test_pass';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'google-client-id';

vi.mock('../../services/donationReceipts.js', () => ({
  getReceiptAccounts: vi.fn(),
  getReceiptTemplate: vi.fn(),
  saveReceiptTemplate: vi.fn(),
  previewReceipt: vi.fn(),
  generateReceiptPdf: vi.fn(),
}));

type RouterCase = {
  name: string;
  mountPath: string;
  probePath: string;
  method: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  role?: 'admin' | 'editor' | 'viewer';
  expectedStatus: number;
  expectedBody:
    | { error: string }
    | { errors: string[] };
  router: express.Router;
};

const routeCases: RouterCase[] = [];

beforeAll(async () => {
  const [
    accountsRouter,
    billsRouter,
    contactsRouter,
    donationReceiptsRouter,
    fiscalPeriodsRouter,
    fundsRouter,
    reconciliationRouter,
    reportsRouter,
    settingsRouter,
    taxRatesRouter,
    usersRouter,
  ] = await Promise.all([
    import('../accounts.js'),
    import('../bills.js'),
    import('../contacts.js'),
    import('../donationReceipts.js'),
    import('../fiscalPeriods.js'),
    import('../funds.js'),
    import('../reconciliation.js'),
    import('../reports.js'),
    import('../settings.js'),
    import('../taxRates.js'),
    import('../users.js'),
  ]);

  routeCases.push(
    {
      name: 'accounts: missing required create fields',
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      role: 'admin',
      body: {},
      expectedStatus: 400,
      expectedBody: { error: 'code, name, and type are required' },
      router: accountsRouter.default as unknown as express.Router,
    },
    {
      name: 'bills: invalid from date query',
      mountPath: '/api/bills',
      probePath: '/?from=not-a-date',
      method: 'GET',
      role: 'editor',
      expectedStatus: 400,
      expectedBody: { error: 'from is not a valid date (YYYY-MM-DD)' },
      router: billsRouter.default as unknown as express.Router,
    },
    {
      name: 'contacts: missing required create fields',
      mountPath: '/api/contacts',
      probePath: '/',
      method: 'POST',
      role: 'admin',
      body: {},
      expectedStatus: 400,
      expectedBody: {
        errors: ['type is required', 'contact_class is required', 'name is required'],
      },
      router: contactsRouter.default as unknown as express.Router,
    },
    {
      name: 'donation receipts: invalid fiscal_year on preview',
      mountPath: '/api/donation-receipts',
      probePath: '/preview',
      method: 'POST',
      role: 'editor',
      body: { fiscal_year: 'bad-year', account_ids: [1] },
      expectedStatus: 400,
      expectedBody: { error: 'fiscal_year must be a valid year' },
      router: donationReceiptsRouter.default as unknown as express.Router,
    },
    {
      name: 'fiscal periods: close requires acknowledged true',
      mountPath: '/api/fiscal-periods',
      probePath: '/close',
      method: 'POST',
      role: 'admin',
      body: { acknowledged: false },
      expectedStatus: 400,
      expectedBody: { error: '`acknowledged` must be true to execute a hard close.' },
      router: fiscalPeriodsRouter.default as unknown as express.Router,
    },
    {
      name: 'funds: missing fund name',
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      role: 'admin',
      body: { code: '3000' },
      expectedStatus: 400,
      expectedBody: { error: 'Fund name is required' },
      router: fundsRouter.default as unknown as express.Router,
    },
    {
      name: 'reconciliation: missing required create fields',
      mountPath: '/api/reconciliations',
      probePath: '/',
      method: 'POST',
      role: 'editor',
      body: {},
      expectedStatus: 400,
      expectedBody: { error: 'account_id, statement_date, and statement_balance are required' },
      router: reconciliationRouter.default as unknown as express.Router,
    },
    {
      name: 'reports: missing date range',
      mountPath: '/api/reports',
      probePath: '/pl',
      method: 'GET',
      role: 'viewer',
      expectedStatus: 400,
      expectedBody: { error: 'from and to query parameters are required' },
      router: reportsRouter.default as unknown as express.Router,
    },
    {
      name: 'settings: invalid body payload type',
      mountPath: '/api/settings',
      probePath: '/',
      method: 'PUT',
      role: 'admin',
      body: [],
      expectedStatus: 400,
      expectedBody: { error: 'Request body must be a key-value object' },
      router: settingsRouter.default as unknown as express.Router,
    },
    {
      name: 'tax rates: missing rate body',
      mountPath: '/api/tax-rates',
      probePath: '/1',
      method: 'PUT',
      role: 'admin',
      body: {},
      expectedStatus: 400,
      expectedBody: { errors: ['rate is required'] },
      router: taxRatesRouter.default as unknown as express.Router,
    },
    {
      name: 'users: missing required create fields',
      mountPath: '/api/users',
      probePath: '/',
      method: 'POST',
      role: 'admin',
      body: {},
      expectedStatus: 400,
      expectedBody: { error: 'email and role are required' },
      router: usersRouter.default as unknown as express.Router,
    },
  );
});

function buildToken(role: 'admin' | 'editor' | 'viewer') {
  return jwt.sign(
    { id: role === 'admin' ? 1 : role === 'editor' ? 2 : 3, email: `${role}@example.com`, role },
    process.env.JWT_SECRET || 'jwt-secret',
  );
}

async function requestRouteValidationFailure(testCase: RouterCase) {
  const app = express();
  app.use(express.json());
  app.use(testCase.mountPath, testCase.router);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}${testCase.mountPath}${testCase.probePath}`, {
    method: testCase.method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${buildToken(testCase.role || 'viewer')}`,
    },
    body: testCase.body === undefined ? undefined : JSON.stringify(testCase.body),
  });
  const json = await response.json();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return { status: response.status, body: json };
}

describe('route validation failure smoke checks', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'jwt-secret';
  });

  it('returns expected 400/422 responses for invalid route inputs', async () => {
    for (const testCase of routeCases) {
      const res = await requestRouteValidationFailure(testCase);
      expect(res.status, testCase.name).toBe(testCase.expectedStatus);
      expect(res.body, testCase.name).toEqual(testCase.expectedBody);
    }
  });
});
