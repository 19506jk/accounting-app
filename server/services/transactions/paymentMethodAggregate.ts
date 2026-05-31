import type { Knex } from 'knex';

export function buildCreditPaymentMethodAggregate(knex: Knex | Knex.Transaction, journalEntryAlias: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(journalEntryAlias)) {
    throw new Error(`Invalid SQL alias: ${journalEntryAlias}`);
  }
  return knex.raw(`
    CASE
      WHEN SUM(CASE WHEN ${journalEntryAlias}.credit > 0 THEN 1 ELSE 0 END) > 0
        AND SUM(CASE WHEN ${journalEntryAlias}.credit > 0 THEN 1 ELSE 0 END) = SUM(CASE WHEN ${journalEntryAlias}.credit > 0 AND ${journalEntryAlias}.payment_method IS NOT NULL THEN 1 ELSE 0 END)
        AND COUNT(DISTINCT CASE WHEN ${journalEntryAlias}.credit > 0 THEN ${journalEntryAlias}.payment_method END) = 1
      THEN MIN(CASE WHEN ${journalEntryAlias}.credit > 0 THEN ${journalEntryAlias}.payment_method END)
      ELSE NULL
    END AS payment_method
  `);
}
