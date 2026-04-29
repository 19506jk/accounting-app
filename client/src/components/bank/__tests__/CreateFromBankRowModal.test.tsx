import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { renderWithProviders } from '../../../test/renderWithProviders';

const createFromBankRowMutateAsync = vi.fn(async () => ({}));
const simulateMutateAsync = vi.fn(async () => ({ matches: [], conflicts: [] }));
const simulateReset = vi.fn();

vi.mock('../../../api/useBankTransactions', () => ({
  useCreateFromBankRow: () => ({ mutateAsync: createFromBankRowMutateAsync, isPending: false }),
}));

vi.mock('../../../api/useBankMatchingRules', () => ({
  useSimulateBankMatchingRule: () => ({
    mutateAsync: simulateMutateAsync,
    isPending: false,
    data: null,
    reset: simulateReset,
  }),
}));

vi.mock('../../../api/useAccounts', () => ({
  useAccounts: () => ({
    data: [
      { id: 1, code: '1000', name: 'Main Bank', type: 'ASSET', is_active: true },
      { id: 2, code: '2050', name: 'Donations Clearing', type: 'ASSET', is_active: true },
      { id: 3, code: '6100', name: 'Office Expense', type: 'EXPENSE', is_active: true },
    ],
  }),
}));

vi.mock('../../../api/useFunds', () => ({
  useFunds: () => ({ data: [{ id: 1, name: 'General', is_active: true }] }),
}));

vi.mock('../../../api/useContacts', () => ({
  useContacts: ({ type }: { type: 'DONOR' | 'PAYEE' }) => ({
    data: [{ id: type === 'DONOR' ? 11 : 12, name: type === 'DONOR' ? 'Alice Donor' : 'Bob Payee', is_active: true }],
  }),
}));

vi.mock('../../../api/useSettings', () => ({
  useSettings: () => ({ data: { etransfer_deposit_offset_account_id: '2' } }),
}));

vi.mock('../../../pages/importCsv/SplitTransactionModal', () => ({
  default: () => null,
}));

const { default: CreateFromBankRowModal } = await import('../CreateFromBankRowModal');

describe('CreateFromBankRowModal', () => {
  it('submits the expected create payload for deposits', async () => {
    createFromBankRowMutateAsync.mockClear();

    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const screen = await renderWithProviders(
      <CreateFromBankRowModal
        bankTransaction={{
          id: 77,
          account_id: 1,
          amount: 120,
          bank_posted_date: '2026-03-10',
          raw_description: 'Interac e-Transfer',
          bank_description_2: 'Alice Donor',
          payment_method: 'E-TRANSFER',
          sender_email: null,
          sender_name: 'Alice Donor',
          bank_transaction_id: 'BTX-1',
          fund_id: 1,
          create_proposal: {
            description: 'Sunday donation',
            reference_no: 'REF-1',
            offset_account_id: 2,
            payee_id: null,
            contact_id: 11,
            splits: undefined,
          },
        } as any}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    await userEvent.fill(screen.getByLabelText('Reference Number'), 'REF-UPDATED');
    await userEvent.click(screen.getByRole('button', { name: 'Create Journal Entry' }));

    expect(createFromBankRowMutateAsync).toHaveBeenCalledWith({
      id: 77,
      payload: expect.objectContaining({
        date: '2026-03-10',
        description: 'Sunday donation',
        reference_no: 'REF-UPDATED',
        amount: 120,
        type: 'deposit',
        offset_account_id: 2,
        contact_id: 11,
      }),
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows payee selection for withdrawals', async () => {
    const screen = await renderWithProviders(
      <CreateFromBankRowModal
        bankTransaction={{
          id: 78,
          account_id: 1,
          amount: -55,
          bank_posted_date: '2026-03-11',
          raw_description: 'Office supplies',
          bank_description_2: '',
          payment_method: 'CARD',
          sender_email: null,
          sender_name: null,
          bank_transaction_id: 'BTX-2',
          fund_id: 1,
          create_proposal: null,
        } as any}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    await expect.element(screen.getByText('Payee')).toBeVisible();
    expect(screen.container.textContent || '').not.toContain('Optional contact');
  });
});
