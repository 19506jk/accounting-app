import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import BankMatchingRuleModal from '../BankMatchingRuleModal';

const updateMutateAsync = vi.fn(async () => ({}));
const createMutateAsync = vi.fn(async () => ({}));
const simulateMutateAsync = vi.fn(async () => ({ matches: [], conflicts: [] }));
const addToast = vi.fn();

vi.mock('../../../api/useBankMatchingRules', () => ({
  useCreateBankMatchingRule: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateBankMatchingRule: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useSimulateBankMatchingRule: () => ({ mutateAsync: simulateMutateAsync, isPending: false, data: null }),
}));
vi.mock('../../../api/useAccounts', () => ({
  useAccounts: () => ({ data: [{ id: 2, code: '1000', name: 'Cash', type: 'ASSET', is_active: true }] }),
}));
vi.mock('../../../api/useFunds', () => ({
  useFunds: () => ({ data: [{ id: 1, name: 'General', is_active: true }] }),
}));
vi.mock('../../../api/useContacts', () => ({
  useContacts: ({ type }: { type: 'DONOR' | 'PAYEE' }) => ({ data: [{ id: type === 'DONOR' ? 11 : 12, name: 'Contact', is_active: true }] }),
}));
vi.mock('../../../api/useTaxRates', () => ({
  useTaxRates: () => ({ data: [{ id: 5, name: 'GST', rate: 0.05 }] }),
}));
vi.mock('../../ui/Toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/Toast')>();
  return {
    ...actual,
    useToast: () => ({ addToast }),
  };
});

describe('BankMatchingRuleModal', () => {
  it('submits updated rule payload', async () => {
    updateMutateAsync.mockClear();
    const onClose = vi.fn();
    const screen = await render(
      <BankMatchingRuleModal
        onClose={onClose}
        rule={{
          id: 9,
          name: 'Match donations',
          transaction_type: 'deposit',
          match_type: 'contains',
          match_pattern: 'etransfer',
          priority: 100,
          is_active: true,
          bank_account_id: 2,
          payee_id: null,
          offset_account_id: 2,
          contact_id: null,
          splits: [],
        } as any}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save Rule' }));
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 9,
        payload: expect.objectContaining({
          name: 'Match donations',
          match_pattern: 'etransfer',
          offset_account_id: 2,
        }),
      })
    );
  });

  it('adds and removes split rows', async () => {
    const screen = await render(<BankMatchingRuleModal onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Use splits' }));
    await expect.element(screen.getByRole('button', { name: 'Add split row' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Add split row' }));
    const removeButtons = () =>
      Array.from(screen.container.querySelectorAll('button'))
        .filter((button) => button.textContent?.includes('Remove row'));

    expect(removeButtons().length).toBeGreaterThan(1);

    await userEvent.click(removeButtons()[0]!);
    expect(removeButtons().length).toBe(1);
  });
});
