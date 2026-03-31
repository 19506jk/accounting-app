/**
 * Migration 013 — deprecate transactions.contact_id
 *
 * Moves all contact tracking to journal_entries.contact_id exclusively.
 *
 * Steps:
 *  1. For any transactions that have contact_id set, copy that value
 *     to all their journal entry lines that don't already have one.
 *  2. Add performance index on journal_entries.contact_id.
 *  3. Drop transactions.contact_id.
 */

exports.up = async function (knex) {
  // Step 1 — copy header contact_id down to journal entry lines
  // Only fills entries where contact_id is not already set
  await knex.raw(`
    UPDATE journal_entries je
    SET contact_id = t.contact_id,
        updated_at = NOW()
    FROM transactions t
    WHERE je.transaction_id = t.id
      AND t.contact_id IS NOT NULL
      AND je.contact_id IS NULL
  `);

  // Step 2 — index for fast donor history + report queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_journal_entries_contact_id
    ON journal_entries(contact_id)
  `);

  // Step 3 — drop the now-redundant column
  await knex.schema.alterTable('transactions', (t) => {
    t.dropColumn('contact_id');
  });
};

exports.down = async function (knex) {
  // Restore column (data loss is acceptable in rollback — dev only)
  await knex.schema.alterTable('transactions', (t) => {
    t.integer('contact_id').unsigned().nullable()
      .references('id').inTable('contacts').onDelete('SET NULL');
  });

  await knex.raw(`
    DROP INDEX IF EXISTS idx_journal_entries_contact_id
  `);
};
