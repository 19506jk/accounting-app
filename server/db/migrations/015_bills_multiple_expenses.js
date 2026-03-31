/**
 * Migration 015 — bills_multiple_expenses
 *
 * Supports multiple expense line items per bill.
 *
 * Changes:
 *   1. Create bill_line_items table for multiple expenses
 *   2. Add created_transaction_id to track original bill transaction
 *   3. Remove expense_account_id from bills (replaced by line items)
 */

exports.up = function(knex) {
  return knex.schema
    .createTable('bill_line_items', (t) => {
      t.increments('id').primary();
      t.integer('bill_id').unsigned().notNullable()
        .references('id').inTable('bills').onDelete('CASCADE');
      t.integer('expense_account_id').unsigned().notNullable()
        .references('id').inTable('accounts').onDelete('RESTRICT');
      t.decimal('amount', 15, 2).notNullable();
      t.string('description', 255).notNullable();
      t.timestamps(true, true);
      t.index('bill_id');
    })
    .table('bills', (t) => {
      t.integer('created_transaction_id').unsigned()
        .references('id').inTable('transactions')
        .onDelete('SET NULL');
      t.dropColumn('expense_account_id');
    });
};

exports.down = function(knex) {
  return knex.schema
    .table('bills', (t) => {
      t.integer('expense_account_id').unsigned()
        .references('id').inTable('accounts')
        .onDelete('RESTRICT');
      t.dropColumn('created_transaction_id');
    })
    .dropTable('bill_line_items');
};