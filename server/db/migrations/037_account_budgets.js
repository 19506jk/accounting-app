exports.up = (knex) =>
  knex.schema.createTable('account_budgets', (t) => {
    t.increments('id').primary();
    t.integer('account_id').notNullable().references('id').inTable('accounts');
    t.integer('fiscal_year').notNullable();
    t.decimal('amount', 15, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['account_id', 'fiscal_year']);
  });

exports.down = (knex) => knex.schema.dropTable('account_budgets');
