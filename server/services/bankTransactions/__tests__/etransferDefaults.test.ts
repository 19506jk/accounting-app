import { describe, expect, it } from 'vitest';

import { defaultCreateDescription, isEtransferDeposit } from '../etransferDefaults.js';

describe('isEtransferDeposit', () => {
  it('returns true for positive amount with Interac payment method', () => {
    expect(isEtransferDeposit(100, 'Interac e-transfer', 'Deposit', null)).toBe(true);
  });

  it('returns true for positive amount with e-transfer token in raw_description', () => {
    expect(isEtransferDeposit(100, null, 'INTERAC E-TRANSFER FROM: JOHN DOE', null)).toBe(true);
  });

  it('returns true for positive amount with e-transfer token in bank_description_2', () => {
    expect(isEtransferDeposit(100, null, 'Deposit', 'e-Transfer from Jane')).toBe(true);
  });

  it('returns false for negative amounts (withdrawals)', () => {
    expect(isEtransferDeposit(-100, 'Interac e-transfer', 'E-transfer payment', null)).toBe(false);
  });

  it('returns false for zero amount', () => {
    expect(isEtransferDeposit(0, 'Interac e-transfer', 'E-transfer payment', null)).toBe(false);
  });

  it('returns false for non-e-transfer deposit', () => {
    expect(isEtransferDeposit(500, 'CASH', 'Counter deposit', null)).toBe(false);
  });

  it('returns false for null payment_method without e-transfer token', () => {
    expect(isEtransferDeposit(100, null, 'Monthly offering', 'General Fund')).toBe(false);
  });
});

describe('defaultCreateDescription', () => {
  // ── joined descriptions ─────────────────────────────────────

  it('joins both descriptions with em-dash when both are present', () => {
    const result = defaultCreateDescription(
      100,
      'Interac e-transfer',
      'Interac e-Transfer',
      'Alice Donor',
      'BTX-001',
    );
    expect(result).toBe('Interac e-Transfer — Alice Donor');
  });

  it('returns only raw_description when bank_description_2 is null', () => {
    const result = defaultCreateDescription(
      100,
      'Interac e-transfer',
      'E-transfer received',
      null,
      'BTX-001',
    );
    expect(result).toBe('E-transfer received');
  });

  it('returns only raw_description when bank_description_2 is empty', () => {
    const result = defaultCreateDescription(
      100,
      'Interac e-transfer',
      'E-transfer received',
      '',
      'BTX-001',
    );
    expect(result).toBe('E-transfer received');
  });

  it('trims whitespace from both fields', () => {
    const result = defaultCreateDescription(
      100,
      null,
      '  Deposit  ',
      '  Jane Donor  ',
      null,
    );
    expect(result).toBe('Deposit — Jane Donor');
  });

  it('returns only raw_description when bank_description_2 is whitespace-only', () => {
    const result = defaultCreateDescription(
      100,
      null,
      'Deposit',
      '   ',
      'BTX-001',
    );
    expect(result).toBe('Deposit');
  });

  // ── bank_transaction_id does NOT affect description ──────────

  it('ignores bank_transaction_id — returns joined description, not the ID', () => {
    const result = defaultCreateDescription(
      75,
      null,
      'INTERAC E-TRANSFER FROM: JOHN DOE',
      null,
      'REF-99',
    );
    expect(result).toBe('INTERAC E-TRANSFER FROM: JOHN DOE');
  });

  it('ignores bank_transaction_id for non-e-transfer deposits too', () => {
    const result = defaultCreateDescription(
      500,
      'CASH',
      'Counter deposit',
      null,
      'DEP-001',
    );
    expect(result).toBe('Counter deposit');
  });

  // ── withdrawals use same joined rule ─────────────────────────

  it('joins descriptions for withdrawals too', () => {
    const result = defaultCreateDescription(
      -75,
      'Interac e-transfer',
      'Interac e-Transfer TO: Store',
      'Shop ABC',
      'W-001',
    );
    expect(result).toBe('Interac e-Transfer TO: Store — Shop ABC');
  });

  it('returns raw_description for withdrawal without bank_description_2', () => {
    const result = defaultCreateDescription(
      -200,
      'CARD',
      'POS PURCHASE Office Depot',
      null,
      'W-002',
    );
    expect(result).toBe('POS PURCHASE Office Depot');
  });

  // ── edge cases ───────────────────────────────────────────────

  it('returns raw_description when amount is 0', () => {
    const result = defaultCreateDescription(
      0,
      'Interac e-transfer',
      'Zero amount e-transfer',
      null,
      'Z-001',
    );
    expect(result).toBe('Zero amount e-transfer');
  });

  it('returns raw_description when both fields are empty', () => {
    const result = defaultCreateDescription(
      100,
      'Interac e-transfer',
      '',
      null,
      'BTX-001',
    );
    expect(result).toBe('');
  });
});
