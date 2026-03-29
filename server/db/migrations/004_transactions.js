/**
 * Migration 004 — transactions + journal_entries
 *
 * Two-table double-entry design:
 *
 *   transactions    — the "header": date, description, who recorded it
 *   journal_entries — the "lines": each debit or credit leg of the transaction
 *
 * Every transaction must have journal_entries where:
 *   SUM(debit) === SUM(credit)
 * This constraint is enforced at the application layer (Express route),
 * not at the DB level, to allow multi-line entries to be inserted atomically.
 *
 * Cash basis: the transaction `date` is the date money actually moved.
 */

exports.up = function (knex) {
  return knex.schema
    .createTable('transactions', (t) => {
      t.increments('id').primary();

      // Cash basis — date money actually moved
      t.date('date').notNullable();
      t.text('description').notNullable();

      // Optional reference (cheque number, transfer ID, deposit slip, etc.)
      t.string('reference_no');

      // Which fund this transaction belongs to
      t.integer('fund_id').unsigned().references('id').inTable('funds').onDelete('RESTRICT');

      // Audit trail — who recorded this
      t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');

      t.timestamps(true, true);
    })
    .createTable('journal_entries', (t) => {
      t.increments('id').primary();

      t.integer('transaction_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('transactions')
        .onDelete('CASCADE'); // deleting a transaction removes all its lines

      t.integer('account_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('RESTRICT'); // cannot delete an account with journal entries

      // Debit and credit stored as separate positive decimal columns.
      // Exactly one of these will be > 0 per row; the other will be 0.
      // Using decimal(15,2) to handle amounts up to $9,999,999,999,999.99
      t.decimal('debit', 15, 2).notNullable().defaultTo(0);
      t.decimal('credit', 15, 2).notNullable().defaultTo(0);

      t.text('memo'); // optional per-line note

      t.timestamps(true, true);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('journal_entries')
    .dropTable('transactions');
};
