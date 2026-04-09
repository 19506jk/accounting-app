/**
 * Migration 016 — fix_bills_constraints
 *
 * Fixes:
 *   1. Add is_voided column to transactions table
 *   2. Make bills.due_date nullable (was notNullable)
 *   3. Make bill_line_items.description nullable (was notNullable)
 */

exports.up = function(knex) {
  return knex.schema
    .table('transactions', (t) => {
      t.boolean('is_voided').notNullable().defaultTo(false);
    })
    .table('bills', (t) => {
      t.date('due_date').alter().nullable();
    })
    .table('bill_line_items', (t) => {
      t.string('description', 255).alter().nullable();
    });
};

exports.down = async function(knex) {
  await knex('bill_line_items')
    .whereNull('description')
    .update({ description: '' });

  await knex('bills')
    .whereNull('due_date')
    .update({ due_date: knex.ref('date') });

  return knex.schema
    .table('bill_line_items', (t) => {
      t.string('description', 255).alter().notNullable();
    })
    .table('bills', (t) => {
      t.date('due_date').alter().notNullable();
    })
    .table('transactions', (t) => {
      t.dropColumn('is_voided');
    });
};
