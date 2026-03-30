/**
 * Migration 011 — add opening_balance to reconciliations
 *
 * Required for the balance formula:
 *   ASSET:     cleared_balance = opening_balance + debits - credits
 *   LIABILITY: cleared_balance = opening_balance - debits + credits
 */

exports.up = function (knex) {
  return knex.schema.alterTable('reconciliations', (t) => {
    t.decimal('opening_balance', 15, 2).notNullable().defaultTo(0);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('reconciliations', (t) => {
    t.dropColumn('opening_balance');
  });
};
