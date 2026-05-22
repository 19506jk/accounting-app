import { describe, expect, it } from 'vitest';
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
