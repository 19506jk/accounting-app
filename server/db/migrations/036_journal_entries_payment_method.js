exports.up = async (knex) => {
  await knex.schema.table('journal_entries', (t) => {
    t.text('payment_method').nullable();
  });

  await knex.raw(`
    UPDATE journal_entries je
    SET payment_method = t.payment_method
    FROM transactions t
    WHERE je.transaction_id = t.id
      AND je.credit > 0
      AND t.payment_method IS NOT NULL
  `);

  await knex.schema.table('transactions', (t) => {
    t.dropColumn('payment_method');
  });
};

exports.down = async (knex) => {
  await knex.schema.table('transactions', (t) => {
    t.text('payment_method').nullable();
  });

  const mixedMethodCountResult = await knex.raw(`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT transaction_id
      FROM journal_entries
      WHERE credit > 0
        AND payment_method IS NOT NULL
      GROUP BY transaction_id
      HAVING COUNT(DISTINCT payment_method) > 1
    ) mixed_methods
  `);
  const mixedMethodCount = Number(mixedMethodCountResult.rows?.[0]?.count ?? 0);
  const mixedMethodTransactions = await knex('journal_entries')
    .where('credit', '>', 0)
    .whereNotNull('payment_method')
    .groupBy('transaction_id')
    .havingRaw('COUNT(DISTINCT payment_method) > 1')
    .select('transaction_id')
    .limit(5);

  if (mixedMethodCount > 0) {
    throw new Error(
      `Cannot roll back 036_journal_entries_payment_method: ${mixedMethodCount} mixed-method deposit(s) exist; sample transaction IDs: ${mixedMethodTransactions.map(({ transaction_id }) => transaction_id).join(', ')}`
    );
  }

  await knex.raw(`
    UPDATE transactions t
    SET payment_method = derived.payment_method
    FROM (
      SELECT ranked.transaction_id, ranked.payment_method
      FROM (
        SELECT
          je.transaction_id,
          je.payment_method,
          ROW_NUMBER() OVER (
            PARTITION BY je.transaction_id
            ORDER BY je.id ASC
          ) AS payment_method_rank
        FROM journal_entries je
        WHERE je.credit > 0
          AND je.payment_method IS NOT NULL
      ) AS ranked
      WHERE ranked.payment_method_rank = 1
    ) AS derived
    WHERE derived.transaction_id = t.id
  `);

  await knex.schema.table('journal_entries', (t) => {
    t.dropColumn('payment_method');
  });
};
