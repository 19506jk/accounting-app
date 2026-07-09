import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/renderWithProviders';
import { worker } from '../../test/msw/browser';
import { Workspace } from '../Reconciliation';
import Reconciliation from '../Reconciliation';
import type { ReconciliationDetail, ReconciliationSummary } from '@shared/contracts';

function buildMockDetail(overrides?: Partial<ReconciliationDetail>): ReconciliationDetail {
  return {
    id: 1,
    account_id: 1,
    account_name: 'Test Bank',
    account_code: '1001',
    account_type: 'ASSET',
    statement_date: '2026-07-08',
    statement_balance: 1000,
    opening_balance: 500,
    is_closed: false,
    created_at: '2026-07-08',
    cleared_balance: 500,
    difference: 500,
    status: 'UNBALANCED',
    summary: {
      total_items: 2,
      cleared_items: 1,
      uncleared_items: 1,
      cleared_debits: 0,
      cleared_credits: 1,
    },
    items: [
      {
        id: 1,
        journal_entry_id: 101,
        is_cleared: false,
        date: '2026-07-08',
        description: 'Deposit with reference',
        reference_no: 'INV-001',
        fund_name: 'General Fund',
        debit: 500,
        credit: 0,
      },
      {
        id: 2,
        journal_entry_id: 102,
        is_cleared: true,
        date: '2026-07-08',
        description: 'Payment without reference',
        reference_no: null,
        fund_name: 'Missions Fund',
        debit: 0,
        credit: 200,
      },
    ],
    ...overrides,
  };
}

describe('Reconciliation Workspace', () => {
  it('renders Reference No column after Fund with values and empty placeholder', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(['reconciliation', 1], buildMockDetail());

    const screen = await renderWithProviders(
      <Workspace
        id={1}
        onBack={vi.fn()}
        onExport={vi.fn()}
        isExporting={false}
        onReopenRequest={vi.fn()}
      />,
      { queryClient },
    );

    const headers = screen.container.querySelectorAll('th');
    const headerTexts = Array.from(headers).map((th) => th.textContent?.trim() ?? '');

    const fundIdx = headerTexts.indexOf('Fund');
    const refIdx = headerTexts.indexOf('Reference No');
    expect(refIdx).toBe(fundIdx + 1);

    await expect.element(screen.getByText('INV-001')).toBeVisible();
    await expect.element(screen.getByRole('cell', { name: '—' })).toBeVisible();
  });

  it('shows Reopen Reconciliation button for admin on closed reconciliation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(['reconciliation', 1], buildMockDetail({ is_closed: true, difference: 0, status: 'BALANCED' }));

    const screen = await renderWithProviders(
      <Workspace
        id={1}
        onBack={vi.fn()}
        onExport={vi.fn()}
        isExporting={false}
        onReopenRequest={vi.fn()}
      />,
      { queryClient, auth: { id: 1, name: 'Admin', email: 'admin@test.local', role: 'admin', avatar_url: null } },
    );

    await expect.element(screen.getByRole('button', { name: 'Reopen Reconciliation' })).toBeVisible();
  });

  it('does not show Reopen Reconciliation button for non-admin on closed reconciliation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(['reconciliation', 1], buildMockDetail({ is_closed: true, difference: 0, status: 'BALANCED' }));

    const screen = await renderWithProviders(
      <Workspace
        id={1}
        onBack={vi.fn()}
        onExport={vi.fn()}
        isExporting={false}
        onReopenRequest={vi.fn()}
      />,
      { queryClient, auth: { id: 2, name: 'Editor', email: 'editor@test.local', role: 'editor', avatar_url: null } },
    );

    const buttons = screen.container.querySelectorAll('button');
    const hasReopen = Array.from(buttons).some((btn) => btn.textContent?.includes('Reopen Reconciliation'));
    expect(hasReopen).toBe(false);
  });

  it('workspace shows editable controls after switching from closed to open', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(['reconciliation', 1], buildMockDetail({ is_closed: true, difference: 0, status: 'BALANCED' }));

    const screen = await renderWithProviders(
      <Workspace
        id={1}
        onBack={vi.fn()}
        onExport={vi.fn()}
        isExporting={false}
        onReopenRequest={vi.fn()}
      />,
      { queryClient, auth: { id: 1, name: 'Admin', email: 'admin@test.local', role: 'admin', avatar_url: null } },
    );

    // Batch controls should NOT be visible when closed
    const closedButtons = screen.container.querySelectorAll('button');
    const hasSelectAll = Array.from(closedButtons).some((btn) => btn.textContent?.includes('Select All'));
    expect(hasSelectAll).toBe(false);

    // Simulate reopen: update cache to open state
    queryClient.setQueryData(['reconciliation', 1], buildMockDetail({ is_closed: false, difference: 500, status: 'UNBALANCED' }));

    // Batch controls should now be visible
    await expect.element(screen.getByRole('button', { name: '☑ Select All' })).toBeVisible();
  });

  it('does not show reopen button on open reconciliation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(['reconciliation', 1], buildMockDetail({ is_closed: false }));

    const screen = await renderWithProviders(
      <Workspace
        id={1}
        onBack={vi.fn()}
        onExport={vi.fn()}
        isExporting={false}
        onReopenRequest={vi.fn()}
      />,
      { queryClient, auth: { id: 1, name: 'Admin', email: 'admin@test.local', role: 'admin', avatar_url: null } },
    );

    const buttons = screen.container.querySelectorAll('button');
    const hasReopen = Array.from(buttons).some((btn) => btn.textContent?.includes('Reopen Reconciliation'));
    expect(hasReopen).toBe(false);
  });
});

describe('Reconciliation List', () => {
  const mockReconciliations: ReconciliationSummary[] = [
    {
      id: 1,
      account_id: 1,
      account_name: 'Test Bank',
      account_code: '1001',
      account_type: 'ASSET',
      statement_date: '2026-07-08',
      statement_balance: 1000,
      opening_balance: 500,
      is_closed: true,
      created_at: '2026-07-08',
      cleared_balance: 1000,
      difference: 0,
      status: 'BALANCED',
      summary: { total_items: 2, cleared_items: 2, uncleared_items: 0, cleared_debits: 1, cleared_credits: 1 },
    },
    {
      id: 2,
      account_id: 1,
      account_name: 'Test Bank',
      account_code: '1001',
      account_type: 'ASSET',
      statement_date: '2026-06-30',
      statement_balance: 500,
      opening_balance: 300,
      is_closed: false,
      created_at: '2026-06-30',
      cleared_balance: 200,
      difference: 300,
      status: 'UNBALANCED',
      summary: { total_items: 1, cleared_items: 0, uncleared_items: 1, cleared_debits: 0, cleared_credits: 0 },
    },
  ];

  function setupListHandlers(reconciliations?: ReconciliationSummary[]) {
    worker.use(
      http.get('/api/reconciliations', () =>
        HttpResponse.json({ reconciliations: reconciliations ?? mockReconciliations })
      ),
      http.get('/api/accounts', () =>
        HttpResponse.json({ accounts: [{ id: 1, code: '1001', name: 'Test Bank', type: 'ASSET' }] })
      ),
    );
  }

  it('admin sees Reopen button for closed reconciliation in list', async () => {
    setupListHandlers();
    const screen = await renderWithProviders(<Reconciliation />, {
      auth: { id: 1, name: 'Admin', email: 'admin@test.local', role: 'admin', avatar_url: null },
    });
    await expect.element(screen.getByRole('button', { name: 'Reopen' })).toBeVisible();
  });

  it('non-admin does not see Reopen button in list', async () => {
    setupListHandlers();
    const screen = await renderWithProviders(<Reconciliation />, {
      auth: { id: 2, name: 'Editor', email: 'editor@test.local', role: 'editor', avatar_url: null },
    });
    // Wait for the list to render (at least one row visible)
    await expect.element(screen.getByRole('button', { name: 'View' })).toBeVisible();
    const buttons = screen.container.querySelectorAll('button');
    const hasReopen = Array.from(buttons).some((btn) => btn.textContent === 'Reopen');
    expect(hasReopen).toBe(false);
  });

  it('clicking reopen in list opens modal with disabled confirm until reason is filled', async () => {
    setupListHandlers();
    const screen = await renderWithProviders(<Reconciliation />, {
      auth: { id: 1, name: 'Admin', email: 'admin@test.local', role: 'admin', avatar_url: null },
    });

    // Click Reopen on the closed reconciliation
    await expect.element(screen.getByRole('button', { name: 'Reopen' })).toBeVisible();
    await screen.getByRole('button', { name: 'Reopen' }).click();

    // Modal should be visible with warning text and disabled confirm
    await expect.element(screen.getByText('This will unreconcile all cleared entries')).toBeVisible();
    const confirmBtn = screen.getByRole('button', { name: 'Reopen Reconciliation' });
    expect(confirmBtn).toBeDisabled();

    // Fill in the reason
    const textarea = screen.container.querySelector('textarea')!;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    nativeSetter.call(textarea, 'Need to fix something');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // Confirm button should now be enabled
    expect(confirmBtn).not.toBeDisabled();
  });
});
