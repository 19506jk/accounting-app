exports.up = (knex) =>
  knex.schema.alterTable('bill_line_items', (t) => {
    t.decimal('rounding_adjustment', 15, 2).notNullable().defaultTo(0);
  });

exports.down = (knex) =>
  knex.schema.alterTable('bill_line_items', (t) => {
    t.dropColumn('rounding_adjustment');
  });
