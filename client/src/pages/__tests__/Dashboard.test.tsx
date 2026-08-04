import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';

import { worker } from '../../test/msw/browser';
import { renderWithProviders } from '../../test/renderWithProviders';
import Dashboard from '../Dashboard';
import type { MonthlyPLPoint, TransactionListItem } from '@shared/contracts';

const emptyPL = { report: { data: { total_income: 0, total_expenses: 0, net_surplus: 0 } } };
const emptyBS = { report: { data: { assets: [], liabilities: [], equity: [] } } };

const JULY_START_SETTINGS = { values: { church_timezone: 'UTC', fiscal_year_start: '7' } };

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

// Twelve points for FY2027 (July 2026 – June 2027) with activity in July and
// September so the chart exercises ticks, titles, and the negative baseline.
// Values are chosen so the y-scale step lands on 2000 and a negative tick is
// reached: rawMin -2500, rawMax 3000 → range ~6820 → step 2000.
function fiscalYearPoints(): MonthlyPLPoint[] {
  const monthStarts = [
    '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01',
    '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01',
  ];
  return monthStarts.map((month_start, i) => ({
    month_start,
    total_income: i === 0 ? 3000 : 0,
    total_expenses: i === 0 ? 1500 : i === 2 ? -2500 : 0,
  }));
}

function stubDashboardApis(
  transactions: TransactionListItem[],
  monthlyPoints: MonthlyPLPoint[] = [],
  settings = JULY_START_SETTINGS,
) {
  worker.use(
    http.get('/api/reports/pl', () => HttpResponse.json(emptyPL)),
    http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
    http.get('/api/transactions', () => HttpResponse.json({ transactions })),
    http.get('/api/settings', () => HttpResponse.json(settings)),
    http.get('/api/reports/pl/monthly', () =>
      HttpResponse.json({ report: { data: { points: monthlyPoints } } })),
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
    stubDashboardApis([], [], JULY_START_SETTINGS);
    worker.use(
      http.get('/api/reports/pl', () =>
        HttpResponse.json({
          report: { data: { total_income: 5000, total_expenses: 3200, net_surplus: 1800 } },
        }),
      ),
    );
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(screen.getByText('$5,000.00')).toBeVisible();
    await expect.element(screen.getByText('$3,200.00')).toBeVisible();
    await expect.element(screen.getByText('$1,800.00')).toBeVisible();
    await expect.element(screen.getByText('July 2026').first()).toBeVisible();
  });
});

describe('Dashboard fiscal-year monthly chart', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests the current fiscal year range and labels the chart FY2027', async () => {
    let monthlyUrl = ''
    worker.use(
      http.get('/api/reports/pl', () => HttpResponse.json(emptyPL)),
      http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
      http.get('/api/transactions', () => HttpResponse.json({ transactions: [] })),
      http.get('/api/settings', () => HttpResponse.json(JULY_START_SETTINGS)),
      http.get('/api/reports/pl/monthly', ({ request }) => {
        monthlyUrl = request.url
        return HttpResponse.json({ report: { data: { points: fiscalYearPoints() } } })
      }),
    );
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(screen.getByText('FY2027')).toBeVisible();
    expect(monthlyUrl).toContain('from=2026-07-01')
    expect(monthlyUrl).toContain('to=2027-06-30')
    await expect.element(
      screen.getByRole('img', { name: 'Income and expenses by month, FY2027' }),
    ).toBeVisible();
  });

  it('renders fiscal-order month labels, legend, formatted values, and both series colors', async () => {
    stubDashboardApis([], fiscalYearPoints(), JULY_START_SETTINGS);
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(screen.getByText('FY2027')).toBeVisible();

    for (const label of ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']) {
      await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
    }

    // Legend and axis ticks.
    await expect.element(screen.getByText('Income', { exact: true })).toBeVisible();
    await expect.element(screen.getByText('Expenses', { exact: true })).toBeVisible();
    await expect.element(screen.getByText('$2K', { exact: true })).toBeVisible();
    await expect.element(screen.getByText('$-2K', { exact: true })).toBeVisible();

    // Bar value titles carry en-CA currency formatting with the sign after
    // the currency symbol ($-2,500.00), matching the dashboard cards.
    const svg = await screen.getByRole('img', { name: 'Income and expenses by month, FY2027' }).element();
    expect(svg.innerHTML).toContain('$3,000.00');
    expect(svg.innerHTML).toContain('$1,500.00');
    expect(svg.innerHTML).toContain('$-2,500.00');

    // Income is always the left, green bar; expenses the right, red bar.
    const greenBars = svg.querySelectorAll('rect[fill="#15803d"]');
    const redBars = svg.querySelectorAll('rect[fill="#b91c1c"]');
    expect(greenBars.length).toBeGreaterThan(0);
    expect(redBars.length).toBeGreaterThan(0);
    expect(Number(greenBars[0]!.getAttribute('x'))).toBeLessThan(Number(redBars[0]!.getAttribute('x')));
  });

  it('shows a skeleton while the monthly request is pending', async () => {
    worker.use(
      http.get('/api/reports/pl', () => HttpResponse.json(emptyPL)),
      http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
      http.get('/api/transactions', () => HttpResponse.json({ transactions: [] })),
      http.get('/api/settings', () => HttpResponse.json(JULY_START_SETTINGS)),
      http.get('/api/reports/pl/monthly', () => new Promise(() => {})),
    );
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(
      screen.getByRole('status', { name: 'Loading income and expenses chart' }),
    ).toBeVisible();
  });

  it('shows a friendly error state when the monthly request fails', async () => {
    worker.use(
      http.get('/api/reports/pl', () => HttpResponse.json(emptyPL)),
      http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
      http.get('/api/transactions', () => HttpResponse.json({ transactions: [] })),
      http.get('/api/settings', () => HttpResponse.json(JULY_START_SETTINGS)),
      http.get('/api/reports/pl/monthly', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    );
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(
      screen.getByText("Couldn't load monthly income and expenses."),
    ).toBeVisible();
  });

  it('shows the error state when settings fail instead of loading forever', async () => {
    let monthlyRequests = 0;
    worker.use(
      http.get('/api/reports/pl', () => HttpResponse.json(emptyPL)),
      http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
      http.get('/api/transactions', () => HttpResponse.json({ transactions: [] })),
      http.get('/api/settings', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
      http.get('/api/reports/pl/monthly', () => {
        monthlyRequests += 1;
        return HttpResponse.json({ report: { data: { points: fiscalYearPoints() } } });
      }),
    );
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(
      screen.getByText("Couldn't load monthly income and expenses."),
    ).toBeVisible();
    // The fiscal range is unknowable without settings, so the monthly query
    // stays disabled and must never fire.
    expect(monthlyRequests).toBe(0);
  });

  it('keeps the chart when a stale settings refetch fails over cached data', async () => {
    let settingsRequests = 0;
    worker.use(
      http.get('/api/reports/pl', () => HttpResponse.json(emptyPL)),
      http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
      http.get('/api/transactions', () => HttpResponse.json({ transactions: [] })),
      http.get('/api/settings', () => {
        settingsRequests += 1;
        return settingsRequests === 1
          ? HttpResponse.json(JULY_START_SETTINGS)
          : HttpResponse.json({ error: 'boom' }, { status: 500 });
      }),
      http.get('/api/reports/pl/monthly', () =>
        HttpResponse.json({ report: { data: { points: fiscalYearPoints() } } })),
    );
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const screen = await renderWithProviders(<Dashboard />, { queryClient });
    await expect.element(screen.getByText('FY2027', { exact: true })).toBeVisible();

    // A background refetch fails, but React Query keeps the cached settings:
    // the fiscal range is still computed, so the chart must not switch to the
    // error state (which would drop the FY chip entirely).
    await queryClient.refetchQueries({ queryKey: ['settings'] });
    expect(settingsRequests).toBe(2);
    await expect.element(screen.getByText('FY2027', { exact: true })).toBeVisible();
    await expect.element(
      screen.getByText("Couldn't load monthly income and expenses."),
    ).not.toBeInTheDocument();
  });

  it('keeps the chart when a stale monthly refetch fails over cached points', async () => {
    let monthlyRequests = 0;
    worker.use(
      http.get('/api/reports/pl', () => HttpResponse.json(emptyPL)),
      http.get('/api/reports/balance-sheet', () => HttpResponse.json(emptyBS)),
      http.get('/api/transactions', () => HttpResponse.json({ transactions: [] })),
      http.get('/api/settings', () => HttpResponse.json(JULY_START_SETTINGS)),
      http.get('/api/reports/pl/monthly', () => {
        monthlyRequests += 1;
        return monthlyRequests === 1
          ? HttpResponse.json({ report: { data: { points: fiscalYearPoints() } } })
          : HttpResponse.json({ error: 'boom' }, { status: 500 });
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    const chart = () =>
      screen.getByRole('img', { name: 'Income and expenses by month, FY2027' });
    const screen = await renderWithProviders(<Dashboard />, { queryClient });
    await expect.element(chart()).toBeVisible();

    // A background refetch fails, but React Query keeps the cached points:
    // the chart must not switch to its error state (which renders no SVG).
    await queryClient.refetchQueries({ queryKey: ['reports', 'pl', 'monthly'] });
    expect(monthlyRequests).toBe(2);
    await expect.element(chart()).toBeVisible();
    await expect.element(
      screen.getByText("Couldn't load monthly income and expenses."),
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when every month is zero', async () => {
    stubDashboardApis([], Array.from({ length: 12 }, (_, i) => ({
      month_start: `${i < 6 ? '2026' : '2027'}-${String((i % 12) + 1).padStart(2, '0')}-01`,
      total_income: 0,
      total_expenses: 0,
    })), JULY_START_SETTINGS);
    const screen = await renderWithProviders(<Dashboard />);
    await expect.element(
      screen.getByText('No income or expenses recorded yet for FY2027.'),
    ).toBeVisible();
  });
});
