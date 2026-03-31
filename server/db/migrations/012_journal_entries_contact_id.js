/**
 * Migration 012 — add contact_id to journal_entries
 *
 * Moves donor tracking from the transaction header to individual
 * journal entry lines. This supports multi-donor transactions where
 * a single bank deposit contains offerings from multiple people.
 *
 * contact_id on transactions is kept for payee-level tracking
 * (e.g. "we paid ABC Supplies") where the whole transaction
 * belongs to one vendor.
 *
 * contact_id on journal_entries handles income lines:
 *   Debit  Checking Account $700  (no contact — bank entry)
 *   Credit Regular Offering $500  → John Smith
 *   Credit Regular Offering $100  → Jane Doe
 *   Credit Regular Offering $100  → (anonymous)
 */

exports.up = function (knex) {
  return knex.schema.alterTable('journal_entries', (t) => {
    t.integer('contact_id').unsigned().nullable()
      .references('id').inTable('contacts').onDelete('SET NULL');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('journal_entries', (t) => {
    t.dropColumn('contact_id');
  });
};
