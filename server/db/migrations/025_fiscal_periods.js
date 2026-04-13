exports.up = async (knex) => {
  await knex.schema.createTable('fiscal_periods', (t) => {
    t.increments('id').primary();
    t.integer('fiscal_year').notNullable();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.string('status', 20).notNullable().defaultTo('HARD_CLOSED');
    t.integer('closing_transaction_id')
      .unsigned()
      .references('id').inTable('transactions')
      .onDelete('RESTRICT');
    t.integer('closed_by')
      .unsigned()
      .references('id').inTable('users')
      .onDelete('SET NULL');
    t.timestamp('closed_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['fiscal_year']);
  });

  await knex.schema.table('transactions', (t) => {
    t.boolean('is_closing_entry').notNullable().defaultTo(false);
  });
};

exports.down = async (knex) => {
  await knex.schema.table('transactions', (t) => t.dropColumn('is_closing_entry'));
  await knex.schema.dropTable('fiscal_periods');
};
