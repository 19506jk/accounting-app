import dotenv from 'dotenv';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'development';

dotenv.config();

let applyBillCredits: typeof import('./billCredits.js').applyBillCredits;

beforeAll(async () => {
  applyBillCredits = (await import('./billCredits.js')).applyBillCredits;
});

describe('applyBillCredits validation', () => {
  it.each([
    [
      'missing applications',
      {},
      ['applications is required'],
    ],
    [
      'empty applications',
      { applications: [] },
      ['applications is required'],
    ],
    [
      'non-array applications',
      { applications: {} },
      ['applications is required'],
    ],
    [
      'non-positive amounts',
      {
        applications: [
          { credit_bill_id: 1, amount: 0 },
          { credit_bill_id: 2, amount: -5 },
        ],
      },
      ['At least one positive application amount is required'],
    ],
    [
      'too many decimal places',
      {
        applications: [
          { credit_bill_id: 1, amount: 10.123 },
        ],
      },
      ['Application amount cannot have more than 2 decimal places'],
    ],
    [
      'duplicate credit bills',
      {
        applications: [
          { credit_bill_id: 1, amount: 5 },
          { credit_bill_id: 1, amount: 10 },
        ],
      },
      ['Duplicate credit bill in applications is not allowed'],
    ],
  ])('rejects %s before opening a transaction', async (_name, payload, errors) => {
    await expect(applyBillCredits('10', payload as any, 42)).resolves.toEqual({ errors });
  });
});
