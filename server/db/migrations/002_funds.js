/**
 * Migration 002 — funds
 * Funds allow the church to track money by purpose
 * (e.g. General Fund, Building Fund, Missions Fund).
 * All transactions and accounts can be optionally tied to a fund.
 */

exports.up = function (knex) {
  return knex.schema.createTable('funds', (t) => {
    t.increments('id').primary();

    t.string('name').notNullable().unique();
    t.text('description');
    t.boolean('is_active').notNullable().defaultTo(true);

    t.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('funds');
};
