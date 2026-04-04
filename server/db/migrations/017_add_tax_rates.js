/**
 * Migration 017 — add_tax_rates
 *
 * Adds:
 *   1. tax_rates table — stores HST/GST rate definitions, linked to their
 *      recoverable Asset account via recoverable_account_id FK
 *   2. journal_entries.tax_rate_id — links an expense line to the tax rate applied
 *   3. journal_entries.is_tax_line — flags auto-generated tax recoverable lines
 *      so they are never treated as user-editable rows
 *
 * Notes:
 *   - recoverable_account_id is nullable at the DB level to allow the table to
 *     be created before accounts exist. The seed file inserts accounts first,
 *     then tax_rates, satisfying the FK at data-entry time.
 *   - rebate_percentage defaults to 1.0000 (100% recoverable). Reserved for
 *     future CRA PSB rebate reporting — unused in v1.
 */

exports.up = function (knex) {
  return knex.schema
    .createTable('tax_rates', (t) => {
      t.increments('id').primary();
      t.string('name', 50).notNullable();
      t.decimal('rate', 5, 4).notNullable();
      t.integer('recoverable_account_id')
        .nullable()
        .references('id')
        .inTable('accounts')
        .onDelete('RESTRICT');
      t.decimal('rebate_percentage', 5, 4).notNullable().defaultTo(1.0000);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    })
    .table('journal_entries', (t) => {
      t.integer('tax_rate_id')
        .nullable()
        .references('id')
        .inTable('tax_rates')
        .onDelete('RESTRICT');
      t.boolean('is_tax_line').notNullable().defaultTo(false);
    });
};

exports.down = function (knex) {
  return knex.schema
    .table('journal_entries', (t) => {
      t.dropColumn('is_tax_line');
      t.dropColumn('tax_rate_id');
    })
    .dropTable('tax_rates');
};
