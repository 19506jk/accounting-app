import { describe, expect, it } from 'vitest';

import {
  extractTrainFromFeedPattern,
  validateBankMatchingRuleDraft,
} from '../ruleEngine.js';

describe('validateBankMatchingRuleDraft', () => {
  it('requires deposit split rules to provide offset_account_id', async () => {
    await expect(validateBankMatchingRuleDraft({
      name: 'Sunday Offering',
      transaction_type: 'deposit',
      match_type: 'contains',
      match_pattern: 'offering',
      splits: [
        {
          percentage: 100,
          fund_id: 1,
          expense_account_id: 200,
        },
      ],
    })).rejects.toThrow('splits[0].offset_account_id is required for deposit rules');
  });

  it('requires withdrawal split rules to provide expense_account_id', async () => {
    await expect(validateBankMatchingRuleDraft({
      name: 'Utilities',
      transaction_type: 'withdrawal',
      match_type: 'contains',
      match_pattern: 'enbridge',
      splits: [
        {
          percentage: 100,
          fund_id: 1,
          offset_account_id: 200,
        },
      ],
    })).rejects.toThrow('splits[0].expense_account_id is required for withdrawal rules');
  });

  it('requires split percentages to total exactly 100.00', async () => {
    await expect(validateBankMatchingRuleDraft({
      name: 'Giving',
      transaction_type: 'deposit',
      match_type: 'contains',
      match_pattern: 'giving',
      splits: [
        {
          percentage: 60,
          fund_id: 1,
          offset_account_id: 200,
        },
        {
          percentage: 39.99,
          fund_id: 2,
          offset_account_id: 200,
        },
      ],
    })).rejects.toThrow('split percentages must total exactly 100.00');
  });
});

describe('extractTrainFromFeedPattern', () => {
  it('uses sender_name for e-transfer style rows when present', () => {
    const pattern = extractTrainFromFeedPattern({
      raw_description: 'INTERAC E-TRANSFER FROM: JOHN DOE',
      sender_name: 'John Doe',
    });
    expect(pattern).toBe('john doe');
  });

  it('removes noise tokens and keeps merchant phrase from raw descriptions', () => {
    const pattern = extractTrainFromFeedPattern({
      raw_description: 'POS PURCHASE VISA TAP STARBUCKS STORE 042',
    });
    expect(pattern).toBe('starbucks store 042');
  });
});
