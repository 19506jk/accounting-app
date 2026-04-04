/**
 * Migration 018 — add_tax_rate_id_to_bill_line_items
 *
 * Adds tax_rate_id FK to bill_line_items so each expense line
 * can record which tax rate (HST/GST) was selected at entry time.
 * Nullable — no tax applied when null (Exempt).
 */

exports.up = function (knex) {
  return knex.schema.table('bill_line_items', (t) => {
    t.integer('tax_rate_id')
      .nullable()
      .references('id')
      .inTable('tax_rates')
      .onDelete('RESTRICT');
  });
};

exports.down = function (knex) {
  return knex.schema.table('bill_line_items', (t) => {
    t.dropColumn('tax_rate_id');
  });
};
