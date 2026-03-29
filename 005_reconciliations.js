/**
 * Migration 005 — reconciliations + rec_items
 *
 * Reconciliation matches the church's book records against a bank statement.
 *
 *   reconciliations — one per bank statement period
 *     · account_id       which bank account is being reconciled
 *     · statement_date   the end date on the bank statement
 *     · statement_balance  the closing balance on the bank statement
 *     · is_closed        once balanced and closed, no further changes allowed
 *
 *   rec_items — one row per journal_entry line being reconciled
 *     · is_cleared  true = this transaction appears on the bank statement
 *
 * Reconciliation is complete when:
 *   statement_balance === book_balance + sum(uncleared items)
 */

exports.up = function (knex) {
  return knex.schema
    .createTable('reconciliations', (t) => {
      t.increments('id').primary();

      t.integer('account_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('RESTRICT');

      t.date('statement_date').notNullable();
      t.decimal('statement_balance', 15, 2).notNullable();

      // Once closed, the reconciliation is locked — no edits
      t.boolean('is_closed').notNullable().defaultTo(false);

      // Audit trail
      t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');

      t.timestamps(true, true);
    })
    .createTable('rec_items', (t) => {
      t.increments('id').primary();

      t.integer('reconciliation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('reconciliations')
        .onDelete('CASCADE');

      t.integer('journal_entry_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('journal_entries')
        .onDelete('CASCADE');

      // Has this line item been matched to the bank statement?
      t.boolean('is_cleared').notNullable().defaultTo(false);

      t.timestamps(true, true);

      // A journal entry can only appear once per reconciliation
      t.unique(['reconciliation_id', 'journal_entry_id']);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('rec_items')
    .dropTable('reconciliations');
};
