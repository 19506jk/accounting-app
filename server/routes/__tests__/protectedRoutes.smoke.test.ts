import express from 'express';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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

type RouteCase = {
  name: string;
  mountPath: string;
  probePath: string;
  router: express.Router;
};

const routeCases: RouteCase[] = [];

beforeAll(async () => {
  const [
    accountsRouter,
    authRouter,
    billsRouter,
    contactsRouter,
    donationReceiptsRouter,
    fiscalPeriodsRouter,
    fundsRouter,
    reconciliationRouter,
    reportsRouter,
    settingsRouter,
    taxRatesRouter,
    transactionsRouter,
    usersRouter,
  ] = await Promise.all([
    import('../accounts.js'),
    import('../auth.js'),
    import('../bills.js'),
    import('../contacts.js'),
    import('../donationReceipts.js'),
    import('../fiscalPeriods.js'),
    import('../funds.js'),
    import('../reconciliation.js'),
    import('../reports.js'),
    import('../settings.js'),
    import('../taxRates.js'),
    import('../transactions.js'),
    import('../users.js'),
  ]);

  routeCases.push(
    { name: 'accounts', mountPath: '/api/accounts', probePath: '/', router: accountsRouter.default as unknown as express.Router },
    { name: 'auth /me', mountPath: '/api/auth', probePath: '/me', router: authRouter.default as unknown as express.Router },
    { name: 'bills', mountPath: '/api/bills', probePath: '/summary', router: billsRouter.default as unknown as express.Router },
    { name: 'contacts', mountPath: '/api/contacts', probePath: '/', router: contactsRouter.default as unknown as express.Router },
    { name: 'donation receipts', mountPath: '/api/donation-receipts', probePath: '/accounts', router: donationReceiptsRouter.default as unknown as express.Router },
    { name: 'fiscal periods', mountPath: '/api/fiscal-periods', probePath: '/', router: fiscalPeriodsRouter.default as unknown as express.Router },
    { name: 'funds', mountPath: '/api/funds', probePath: '/', router: fundsRouter.default as unknown as express.Router },
    { name: 'reconciliations', mountPath: '/api/reconciliations', probePath: '/', router: reconciliationRouter.default as unknown as express.Router },
    { name: 'reports', mountPath: '/api/reports', probePath: '/pl', router: reportsRouter.default as unknown as express.Router },
    { name: 'settings', mountPath: '/api/settings', probePath: '/', router: settingsRouter.default as unknown as express.Router },
    { name: 'tax rates', mountPath: '/api/tax-rates', probePath: '/', router: taxRatesRouter.default as unknown as express.Router },
    { name: 'transactions', mountPath: '/api/transactions', probePath: '/', router: transactionsRouter.default as unknown as express.Router },
    { name: 'users', mountPath: '/api/users', probePath: '/', router: usersRouter.default as unknown as express.Router },
  );
});

async function requestWithoutAuth(routeCase: RouteCase) {
  const app = express();
  app.use(express.json());
  app.use(routeCase.mountPath, routeCase.router);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}${routeCase.mountPath}${routeCase.probePath}`);
  const json = await response.json();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return { status: response.status, body: json };
}

describe('protected route smoke checks', () => {
  it('rejects unauthenticated requests across protected routes', async () => {
    for (const routeCase of routeCases) {
      const res = await requestWithoutAuth(routeCase);
      expect(res.status, routeCase.name).toBe(401);
      expect(res.body, routeCase.name).toEqual({ error: 'Missing or malformed Authorization header' });
    }
  });
});
