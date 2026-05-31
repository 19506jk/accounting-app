import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import client from '../../../api/client';
import TransactionTable from '../TransactionTable';
import type { TransactionDetail, TransactionListItem } from '@shared/contracts';

vi.mock('../../../api/client', () => ({
  default: {
    get: vi.fn(),
  },
}));

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

const clientGet = vi.mocked(client.get);

describe('TransactionTable', () => {
  it('renders entry payment methods in the expanded detail view', async () => {
    const detail: TransactionDetail = {
      id: 99,
      date: '2026-05-01',
      description: 'Sunday offering',
      reference_no: null,
      payment_method: 'cheque',
      transaction_type: 'deposit',
      fund_id: 1,
      created_at: '2026-05-01T12:00:00.000Z',
      is_voided: false,
      entries: [
        {
          id: 1,
          account_id: 10,
          account_code: '1000',
          account_name: 'Bank',
          account_type: 'ASSET',
          fund_id: 1,
          fund_name: 'General',
          debit: 500,
          credit: 0,
          payment_method: null,
          memo: null,
          is_reconciled: false,
          contact_id: null,
          contact_name: null,
        },
        {
          id: 2,
          account_id: 20,
          account_code: '4000',
          account_name: 'Donations',
          account_type: 'INCOME',
          fund_id: 1,
          fund_name: 'General',
          debit: 0,
          credit: 500,
          payment_method: 'cheque',
          memo: 'Offering',
          is_reconciled: false,
          contact_id: null,
          contact_name: null,
        },
      ],
    };

    clientGet.mockResolvedValueOnce({ data: { transaction: detail } });

    const screen = await render(
      <TransactionTable
        rows={[depositRow('cheque')]}
        expandedId={99}
        onExpandedChange={vi.fn()}
      />
    );

    await expect.element(screen.getByText('Method')).toBeVisible();
    await expect.element(screen.getByRole('row', { name: '4000 Donations General — Cheque Offering $500.00', exact: true })).toBeVisible();
  });

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
