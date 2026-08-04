import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { worker } from '../../test/msw/browser';
import { renderWithProviders } from '../../test/renderWithProviders';
import Dashboard from '../Dashboard';
import type { TransactionListItem } from '@shared/contracts';

const emptyPL = { report: { data: { total_income: 0, total_expenses: 0, net_surplus: 0 } } };
const emptyBS = { report: { data: { assets: [], liabilities: [], equity: [] } } };

function depositRow(payment_method: string | null): TransactionListItem {
  return {
    id: 1,
    date: '2026-05-01',
    description: 'Sunday offering',
    transaction_type: 'deposit',
    contact_name: null,
    has_multiple_contacts: false,
    reference_no: null,
    payment_method,
    total_amount: 500,
    is_voided: false,
  } as unknown as TransactionListItem;
}

function stubDashboardApis(transactions: TransactionListItem[]) {
  worker.use(
    http.get('/api/reports/pl', () => HttpResponse.json(emptyPL)),
    http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
    http.get('/api/transactions', () => HttpResponse.json({ transactions })),
  );
}

describe('Dashboard deposit type badges', () => {
  it.each([
    ['cash',       'Cash'],
    ['cheque',     'Cheque'],
    ['e-transfer', 'E-Transfer'],
  ])('renders %s deposit with badge label "%s"', async (paymentMethod, expectedLabel) => {
    stubDashboardApis([depositRow(paymentMethod)]);
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(screen.getByText(expectedLabel)).toBeVisible();
  });

  it('falls back to "Deposit" badge when payment_method is null', async () => {
    stubDashboardApis([depositRow(null)]);
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(screen.getByText('Deposit')).toBeVisible();
  });
});

describe('Dashboard previous-month P&L', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('displays income, expenses, surplus, and previous-month label', async () => {
    worker.use(
      http.get('/api/reports/pl', () =>
        HttpResponse.json({
          report: { data: { total_income: 5000, total_expenses: 3200, net_surplus: 1800 } },
        }),
      ),
      http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
      http.get('/api/transactions', () => HttpResponse.json({ transactions: [] })),
    );
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(screen.getByText('$5,000.00')).toBeVisible();
    await expect.element(screen.getByText('$3,200.00')).toBeVisible();
    await expect.element(screen.getByText('$1,800.00')).toBeVisible();
    await expect.element(screen.getByText('July 2026').first()).toBeVisible();
  });
});
