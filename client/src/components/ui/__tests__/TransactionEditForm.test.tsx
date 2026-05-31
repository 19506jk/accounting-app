import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';

import { worker } from '../../../test/msw/browser';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { TransactionEditForm } from '../../../pages/Transactions';
import type { TransactionDetail } from '@shared/contracts';

const baseEntry = {
  account_code: 'TEST',
  account_name: 'Test Account',
  fund_name: 'General',
  memo: null,
  is_reconciled: false,
  contact_id: null,
  contact_name: null,
};

function makeDeposit(payment_method: string | null): TransactionDetail {
  return {
    id: 1,
    date: '2026-05-01',
    description: 'Sunday offering',
    reference_no: null,
    payment_method,
    transaction_type: 'deposit',
    fund_id: 1,
    created_at: '2026-05-01T00:00:00.000Z',
    is_voided: false,
    entries: [
      { ...baseEntry, id: 1, account_id: 10, account_type: 'ASSET',  fund_id: 1, debit: 500, credit: 0, payment_method: null },
      { ...baseEntry, id: 2, account_id: 20, account_type: 'INCOME', fund_id: 1, debit: 0,   credit: 500, payment_method },
    ],
  };
}

const withdrawalTx: TransactionDetail = {
  id: 2,
  date: '2026-05-01',
  description: 'Office supplies',
  reference_no: null,
  payment_method: null,
  transaction_type: 'withdrawal',
  fund_id: 1,
    created_at: '2026-05-01T00:00:00.000Z',
    is_voided: false,
    entries: [
    { ...baseEntry, id: 3, account_id: 30, account_type: 'EXPENSE', fund_id: 1, debit: 100, credit: 0, payment_method: null },
    { ...baseEntry, id: 4, account_id: 10, account_type: 'ASSET',   fund_id: 1, debit: 0,   credit: 100, payment_method: null },
  ],
};

function stubApis() {
  worker.use(
    http.get('/api/accounts', () => HttpResponse.json({ accounts: [] })),
    http.get('/api/funds',    () => HttpResponse.json({ funds: [] })),
    http.get('/api/contacts', () => HttpResponse.json({ contacts: [] })),
  );
}

const noop = () => {};

describe('TransactionEditForm payment method fields', () => {
  it('shows per-entry payment method selects for a deposit', async () => {
    stubApis();
    const screen = await renderWithProviders(
      <TransactionEditForm transaction={makeDeposit('cash')} onClose={noop} />
    );
    expect(screen.getByLabelText('Payment Method 1').query()).toBeNull();
    await expect.element(screen.getByLabelText('Payment Method 2')).toHaveValue('cash');
  });

  it('does not render per-entry payment method selects for a withdrawal', async () => {
    stubApis();
    const screen = await renderWithProviders(
      <TransactionEditForm transaction={withdrawalTx} onClose={noop} />
    );
    expect(screen.getByLabelText('Payment Method 1').query()).toBeNull();
  });

  it('shows "—" option selected when a deposit entry payment_method is null', async () => {
    stubApis();
    const screen = await renderWithProviders(
      <TransactionEditForm transaction={makeDeposit(null)} onClose={noop} />
    );
    await expect.element(screen.getByLabelText('Payment Method 2')).toHaveValue('');
  });

  it('includes per-entry payment_method values in PUT body for deposits', async () => {
    stubApis();
    let capturedBody: Record<string, unknown> | null = null;
    worker.use(
      http.put('/api/transactions/1', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ transaction: makeDeposit('cash') });
      })
    );

    const screen = await renderWithProviders(
      <TransactionEditForm transaction={makeDeposit('cash')} onClose={noop} />
    );
    await userEvent.selectOptions(screen.getByLabelText('Payment Method 2'), 'cheque');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await expect.element(screen.getByText('Transaction updated.')).toBeVisible();

    expect(capturedBody).not.toBeNull();
    expect(capturedBody).not.toHaveProperty('payment_method');
    expect(capturedBody).toHaveProperty('entries.0.payment_method', null);
    expect(capturedBody).toHaveProperty('entries.1.payment_method', 'cheque');
  });

  it('clears stale debit-side payment_method values before submit', async () => {
    stubApis();
    let capturedBody: Record<string, unknown> | null = null;
    worker.use(
      http.put('/api/transactions/1', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ transaction: makeDeposit('cash') });
      })
    );

    const screen = await renderWithProviders(
      <TransactionEditForm
        transaction={{
          ...makeDeposit('cash'),
          entries: [
            { ...makeDeposit('cash').entries![0]!, payment_method: 'cash' },
            makeDeposit('cash').entries![1]!,
          ],
        }}
        onClose={noop}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await expect.element(screen.getByText('Transaction updated.')).toBeVisible();

    expect(capturedBody).toHaveProperty('entries.0.payment_method', null);
  });

  it('omits payment_method from PUT body for withdrawals', async () => {
    stubApis();
    let capturedBody: Record<string, unknown> | null = null;
    worker.use(
      http.put('/api/transactions/2', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ transaction: withdrawalTx });
      })
    );

    const screen = await renderWithProviders(
      <TransactionEditForm transaction={withdrawalTx} onClose={noop} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await expect.element(screen.getByText('Transaction updated.')).toBeVisible();

    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toHaveProperty('entries.0.payment_method', null);
    expect(capturedBody).toHaveProperty('entries.1.payment_method', null);
  });
});
