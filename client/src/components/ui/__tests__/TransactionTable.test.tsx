import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import TransactionTable from '../TransactionTable';
import type { TransactionListItem } from '@shared/contracts';

const row = {
  id: 11,
  date: '2026-04-10',
  description: 'Office supplies',
  transaction_type: 'withdrawal',
  contact_name: null,
  has_multiple_contacts: false,
  reference_no: null,
  payment_method: null,
  total_amount: 123.45,
  is_voided: false,
} as unknown as TransactionListItem;

function depositRow(payment_method: string | null): TransactionListItem {
  return {
    id: 99,
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

describe('TransactionTable', () => {
  it('renders empty state when no rows are present', async () => {
    const screen = await render(<TransactionTable rows={[]} emptyText='No entries yet' />);

    await expect.element(screen.getByText('No entries yet')).toBeVisible();
  });

  it('renders row data and calls delete action', async () => {
    const onDelete = vi.fn();
    const screen = await render(
      <TransactionTable
        rows={[row]}
        onDelete={onDelete}
      />
    );

    await expect.element(screen.getByText('Office supplies')).toBeVisible();
    await expect.element(screen.getByText('Withdrawal')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[1]).toBe(11);
  });

  describe('deposit type badges', () => {
    it.each([
      ['cash',       'Cash'],
      ['cheque',     'Cheque'],
      ['e-transfer', 'E-Transfer'],
    ])('renders %s deposit with badge label "%s"', async (paymentMethod, expectedLabel) => {
      const screen = await render(<TransactionTable rows={[depositRow(paymentMethod)]} />);
      await expect.element(screen.getByText(expectedLabel)).toBeVisible();
    });

    it('falls back to "Deposit" badge when payment_method is null', async () => {
      const screen = await render(<TransactionTable rows={[depositRow(null)]} />);
      await expect.element(screen.getByText('Deposit')).toBeVisible();
    });
  });
});
