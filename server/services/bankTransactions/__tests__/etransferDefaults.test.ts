import { describe, expect, it } from 'vitest';

import { defaultCreateDescription } from '../etransferDefaults.js';

describe('defaultCreateDescription', () => {
  // ── e-transfer deposit with reference ──────────────────────

  it('returns bank_transaction_id for e-transfer deposit via payment_method', () => {
    const result = defaultCreateDescription(
      120,                    // amount (positive = deposit)
      'Interac e-transfer',   // payment_method (exact match)
      'Interac e-Transfer',   // raw_description
      'Alice Donor',          // bank_description_2
      'BTX-001',              // bank_transaction_id
    );
    expect(result).toBe('BTX-001');
  });

  it('returns bank_transaction_id for e-transfer deposit via token in raw_description', () => {
    const result = defaultCreateDescription(
      75,
      null,                    // no payment_method — detection via raw_description token
      'INTERAC E-TRANSFER FROM: JOHN DOE',  // contains token
      null,
      'REF-99',
    );
    expect(result).toBe('REF-99');
  });

  it('returns bank_transaction_id for E-TRANSFER payment_method with generic description', () => {
    // This is the case that was previously missed by the narrow
    // 'interac e-transfer' exact-match check.
    const result = defaultCreateDescription(
      100,
      'E-TRANSFER',            // caught by broad isETransferPaymentMethod
      'Deposit',               // no e-transfer token in description
      null,
      'ET-200',
    );
    expect(result).toBe('ET-200');
  });

  it('returns bank_transaction_id for "etransfer" payment_method variant', () => {
    const result = defaultCreateDescription(
      100,
      'etransfer',
      'Payment received',
      null,
      'ETR-300',
    );
    expect(result).toBe('ETR-300');
  });

  it('returns bank_transaction_id for "e transfer" payment_method variant', () => {
    const result = defaultCreateDescription(
      100,
      'e transfer',
      'Payment received',
      null,
      'ETR-400',
    );
    expect(result).toBe('ETR-400');
  });

  it('returns bank_transaction_id for "autodeposit" payment_method variant', () => {
    const result = defaultCreateDescription(
      100,
      'autodeposit',
      'Payment received',
      null,
      'ETR-500',
    );
    expect(result).toBe('ETR-500');
  });

  it('returns bank_transaction_id for "auto deposit" payment_method variant', () => {
    const result = defaultCreateDescription(
      100,
      'auto deposit',
      'Payment received',
      null,
      'ETR-600',
    );
    expect(result).toBe('ETR-600');
  });

  it('returns bank_transaction_id for e-transfer deposit via token in bank_description_2', () => {
    const result = defaultCreateDescription(
      200,
      null,                    // no payment_method
      'Deposit',               // no e-transfer token here
      'e-Transfer from Jane',  // token in bank_description_2
      'ET-555',
    );
    expect(result).toBe('ET-555');
  });

  it('returns bank_transaction_id for "etransfer" token variant', () => {
    const result = defaultCreateDescription(
      50,
      null,
      'etransfer received',    // contains 'etransfer'
      null,
      'TXN-1',
    );
    expect(result).toBe('TXN-1');
  });

  it('returns bank_transaction_id for "interac e-transfer" token variant', () => {
    const result = defaultCreateDescription(
      300,
      null,
      'INTERAC E-TRANSFER payment',
      null,
      'INT-100',
    );
    expect(result).toBe('INT-100');
  });

  // ── fallback: no reference ─────────────────────────────────

  it('returns raw_description when e-transfer deposit has no bank_transaction_id', () => {
    const result = defaultCreateDescription(
      120,
      'Interac e-transfer',
      'Interac e-Transfer',
      'Alice Donor',
      null,                    // no reference
    );
    expect(result).toBe('Interac e-Transfer');
  });

  it('returns raw_description when e-transfer deposit has empty bank_transaction_id', () => {
    const result = defaultCreateDescription(
      120,
      'Interac e-transfer',
      'Interac e-Transfer',
      'Alice Donor',
      '',                      // empty string
    );
    expect(result).toBe('Interac e-Transfer');
  });

  // ── fallback: not e-transfer ───────────────────────────────

  it('returns raw_description for non-e-transfer deposit', () => {
    const result = defaultCreateDescription(
      500,
      'CASH',
      'Counter deposit',
      null,
      'DEP-001',
    );
    expect(result).toBe('Counter deposit');
  });

  it('returns raw_description for non-e-transfer deposit with null payment_method', () => {
    const result = defaultCreateDescription(
      100,
      null,
      'Monthly offering',
      'General Fund',
      'DEP-002',
    );
    expect(result).toBe('Monthly offering');
  });

  // ── withdrawals always fall back ───────────────────────────

  it('returns raw_description for e-transfer withdrawal (amount < 0)', () => {
    const result = defaultCreateDescription(
      -75,
      'Interac e-transfer',
      'Interac e-Transfer TO: Store',
      'Shop ABC',
      'W-001',
    );
    expect(result).toBe('Interac e-Transfer TO: Store');
  });

  it('returns raw_description for non-e-transfer withdrawal', () => {
    const result = defaultCreateDescription(
      -200,
      'CARD',
      'POS PURCHASE Office Depot',
      null,
      'W-002',
    );
    expect(result).toBe('POS PURCHASE Office Depot');
  });

  // ── edge cases ─────────────────────────────────────────────

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

  it('returns raw_description for whitespace-only bank_transaction_id', () => {
    const result = defaultCreateDescription(
      120,
      'Interac e-transfer',
      'E-transfer deposit',
      null,
      '   ',
    );
    expect(result).toBe('E-transfer deposit');
  });
});
