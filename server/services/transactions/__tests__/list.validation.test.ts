import dotenv from 'dotenv';
import type { TransactionsQuery } from '@shared/contracts';
import { beforeAll, describe, expect, it } from 'vitest';

dotenv.config();

let listTransactions: (query: TransactionsQuery) => Promise<unknown>;

beforeAll(async () => {
  const module = await import('../list.js');
  listTransactions = module.listTransactions;
});

async function expectBadRequest(query: TransactionsQuery, message: string) {
  await expect(listTransactions(query)).rejects.toMatchObject({
    message,
    status: 400,
    statusCode: 400,
  });
}

describe('listTransactions validation', () => {
  it('rejects invalid transaction_type', async () => {
    await expectBadRequest(
      { transaction_type: 'deposit-and-withdrawal' as TransactionsQuery['transaction_type'] },
      'transaction_type must be one of deposit, withdrawal, transfer'
    );
  });

  it('rejects invalid from date', async () => {
    await expectBadRequest(
      { from: '04-17-2026' },
      'from is not a valid date (YYYY-MM-DD)'
    );
  });

  it('rejects invalid to date', async () => {
    await expectBadRequest(
      { to: '2026/04/17' },
      'to is not a valid date (YYYY-MM-DD)'
    );
  });

  it('rejects from dates that are after to', async () => {
    await expectBadRequest(
      { from: '2026-04-18', to: '2026-04-17' },
      'from must be before or equal to to'
    );
  });
});
