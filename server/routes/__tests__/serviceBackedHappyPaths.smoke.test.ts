import express from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'development';
process.env.DB_NAME = process.env.DB_NAME || 'test_db';
process.env.DB_USER = process.env.DB_USER || 'test_user';
process.env.DB_PASS = process.env.DB_PASS || 'test_pass';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'google-client-id';

const donationReceiptServiceMocks = vi.hoisted(() => ({
  getReceiptAccounts: vi.fn(),
  getReceiptTemplate: vi.fn(),
  saveReceiptTemplate: vi.fn(),
  previewReceipt: vi.fn(),
  generateReceiptPdf: vi.fn(),
}));

const billsServiceMocks = vi.hoisted(() => ({
  createBill: vi.fn(),
  updateBill: vi.fn(),
  payBill: vi.fn(),
  voidBill: vi.fn(),
  getAvailableCreditsForBill: vi.fn(),
  applyBillCredits: vi.fn(),
  unapplyBillCredits: vi.fn(),
  getAgingReport: vi.fn(),
  getUnpaidSummary: vi.fn(),
  getBillWithLineItems: vi.fn(),
}));

const transactionListMocks = vi.hoisted(() => ({
  listTransactions: vi.fn(),
}));

const transactionBillMatchesMocks = vi.hoisted(() => ({
  getBillMatchSuggestions: vi.fn(),
}));

const reportsMocks = vi.hoisted(() => ({
  getPL: vi.fn(),
  getBalanceSheet: vi.fn(),
  getLedger: vi.fn(),
  getTrialBalance: vi.fn(),
  getDonorSummary: vi.fn(),
  getDonorDetail: vi.fn(),
}));

vi.mock('../services/donationReceipts.js', () => donationReceiptServiceMocks);
vi.mock('../services/bills.js', () => billsServiceMocks);
vi.mock('../services/transactions/list.js', () => transactionListMocks);
vi.mock('../services/transactions/billMatches.js', () => transactionBillMatchesMocks);
vi.mock('../services/reports.js', () => reportsMocks);

let billsRouter: express.Router;
let transactionsRouter: express.Router;
let reportsRouter: express.Router;
let donationReceiptsRouter: express.Router;

beforeAll(async () => {
  const [billsModule, transactionsModule, reportsModule, donationReceiptsModule] = await Promise.all([
    import('../bills.js'),
    import('../transactions.js'),
    import('../reports.js'),
    import('../donationReceipts.js'),
  ]);
  billsRouter = billsModule.default as unknown as express.Router;
  transactionsRouter = transactionsModule.default as unknown as express.Router;
  reportsRouter = reportsModule.default as unknown as express.Router;
  donationReceiptsRouter = donationReceiptsModule.default as unknown as express.Router;
});

beforeEach(() => {
  process.env.JWT_SECRET = 'jwt-secret';
  vi.clearAllMocks();
});

function buildToken(role: 'admin' | 'editor' | 'viewer' = 'admin') {
  return jwt.sign(
    { id: role === 'admin' ? 1 : role === 'editor' ? 2 : 3, email: `${role}@example.com`, role },
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
  method: 'GET' | 'POST';
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

describe('service-backed happy path smoke checks', () => {
  it('returns bill summary from service', async () => {
    const summary = { unpaid_count: 2, total_unpaid: 150.5 };
    billsServiceMocks.getUnpaidSummary.mockResolvedValue(summary);

    const res = await requestRoute({
      mountPath: '/api/bills',
      probePath: '/summary',
      method: 'GET',
      router: billsRouter,
      role: 'viewer',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary });
    expect(billsServiceMocks.getUnpaidSummary).toHaveBeenCalledTimes(1);
  });

  it('creates bill via service and returns 201', async () => {
    const payload = { date: '2026-01-05', contact_id: 42, line_items: [] };
    const bill = { id: 777, status: 'DRAFT' };
    billsServiceMocks.createBill.mockResolvedValue({ bill, transaction: null });

    const res = await requestRoute({
      mountPath: '/api/bills',
      probePath: '/',
      method: 'POST',
      router: billsRouter,
      role: 'editor',
      body: payload,
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ bill, transaction: undefined });
    expect(billsServiceMocks.createBill).toHaveBeenCalledWith(payload, 2);
  });

  it('returns transactions list from list service', async () => {
    const listResult = { transactions: [], total: 0, limit: 100, offset: 0 };
    transactionListMocks.listTransactions.mockResolvedValue(listResult);

    const res = await requestRoute({
      mountPath: '/api/transactions',
      probePath: '/?limit=100&offset=0',
      method: 'GET',
      router: transactionsRouter,
      role: 'viewer',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(listResult);
    expect(transactionListMocks.listTransactions).toHaveBeenCalledWith({ limit: '100', offset: '0' });
  });

  it('returns bill match suggestions from import service', async () => {
    const payload = { imported_transactions: [{ date: '2026-01-10', amount: 100 }] };
    const matchResult = { matches: [] };
    transactionBillMatchesMocks.getBillMatchSuggestions.mockResolvedValue(matchResult);

    const res = await requestRoute({
      mountPath: '/api/transactions',
      probePath: '/import/bill-matches',
      method: 'POST',
      router: transactionsRouter,
      role: 'editor',
      body: payload,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(matchResult);
    expect(transactionBillMatchesMocks.getBillMatchSuggestions).toHaveBeenCalledWith(payload);
  });

  it('returns profit and loss report envelope from service', async () => {
    const reportData = { totals: { income: 1000, expense: 250, net: 750 }, rows: [] };
    reportsMocks.getPL.mockResolvedValue(reportData);

    const res = await requestRoute({
      mountPath: '/api/reports',
      probePath: '/pl?from=2026-01-01&to=2026-01-31&fund_id=3',
      method: 'GET',
      router: reportsRouter,
      role: 'viewer',
    });

    expect(res.status).toBe(200);
    expect(res.body.report.type).toBe('pl');
    expect(res.body.report.filters).toEqual({ from: '2026-01-01', to: '2026-01-31', fund_id: '3' });
    expect(res.body.report.data).toEqual(reportData);
    expect(typeof res.body.report.generated_at).toBe('string');
    expect(reportsMocks.getPL).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31', fundId: '3' });
  });

  it('returns donation receipt template from service', async () => {
    const template = { markdown_body: 'Hello {{donor_name}}' };
    donationReceiptServiceMocks.getReceiptTemplate.mockResolvedValue(template);

    const res = await requestRoute({
      mountPath: '/api/donation-receipts',
      probePath: '/template',
      method: 'GET',
      router: donationReceiptsRouter,
      role: 'viewer',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(template);
    expect(donationReceiptServiceMocks.getReceiptTemplate).toHaveBeenCalledTimes(1);
  });

  it('returns donation receipt preview from service', async () => {
    const payload = { fiscal_year: 2025, account_ids: [1, 2], markdown_body: 'preview body' };
    const preview = { receipts: [{ contact_id: 1, amount: 50 }], totals: { amount: 50, count: 1 } };
    donationReceiptServiceMocks.previewReceipt.mockResolvedValue(preview);

    const res = await requestRoute({
      mountPath: '/api/donation-receipts',
      probePath: '/preview',
      method: 'POST',
      router: donationReceiptsRouter,
      role: 'editor',
      body: payload,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(preview);
    expect(donationReceiptServiceMocks.previewReceipt).toHaveBeenCalledWith(2025, [1, 2], 'preview body');
  });
});
