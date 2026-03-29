/**
 * Migration 010 — add is_reconciled to journal_entries
 *
 * This is the hook Module 7 (Reconciliation) uses to lock
 * journal entries that have been matched to a bank statement.
 * A transaction cannot be deleted if any of its entries
 * have is_reconciled = true.
 */

exports.up = function (knex) {
  return knex.schema.alterTable('journal_entries', (t) => {
    t.boolean('is_reconciled').notNullable().defaultTo(false);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('journal_entries', (t) => {
    t.dropColumn('is_reconciled');
  });
};
