import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/renderWithProviders';
import { Workspace } from '../Reconciliation';
import type { ReconciliationDetail } from '@shared/contracts';

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
      />,
      { queryClient },
    );

    // Header assertions
    const headers = screen.container.querySelectorAll('th');
    const headerTexts = Array.from(headers).map((th) => th.textContent?.trim() ?? '');

    const fundIdx = headerTexts.indexOf('Fund');
    const refIdx = headerTexts.indexOf('Reference No');
    expect(refIdx).toBe(fundIdx + 1);

    // Populated reference value renders
    await expect.element(screen.getByText('INV-001')).toBeVisible();

    // Missing reference renders placeholder (use getByRole to avoid matching the h1 heading)
    await expect.element(screen.getByRole('cell', { name: '—' })).toBeVisible();
  });
});
