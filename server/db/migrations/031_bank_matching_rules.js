exports.up = async function (knex) {
  await knex.schema.createTable('bank_matching_rules', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.integer('priority').notNullable().defaultTo(100);
    t.string('transaction_type', 20).notNullable();
    t.string('match_type', 20).notNullable();
    t.text('match_pattern').notNullable();
    t.integer('bank_account_id').unsigned()
      .references('id').inTable('accounts')
      .onDelete('SET NULL');
    t.integer('offset_account_id').unsigned()
      .references('id').inTable('accounts')
      .onDelete('SET NULL');
    t.integer('payee_id').unsigned()
      .references('id').inTable('contacts')
      .onDelete('SET NULL');
    t.integer('contact_id').unsigned()
      .references('id').inTable('contacts')
      .onDelete('SET NULL');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('deleted_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['is_active']);
    t.index(['transaction_type']);
    t.index(['priority']);
    t.index(['bank_account_id']);
    t.index(['deleted_at']);
  });

  await knex.schema.createTable('bank_matching_rule_splits', (t) => {
    t.increments('id').primary();
    t.integer('rule_id').unsigned().notNullable()
      .references('id').inTable('bank_matching_rules')
      .onDelete('CASCADE');
    t.decimal('percentage', 8, 4).notNullable();
    t.integer('fund_id').unsigned().notNullable()
      .references('id').inTable('funds')
      .onDelete('RESTRICT');
    t.integer('offset_account_id').unsigned()
      .references('id').inTable('accounts')
      .onDelete('SET NULL');
    t.integer('expense_account_id').unsigned()
      .references('id').inTable('accounts')
      .onDelete('SET NULL');
    t.integer('contact_id').unsigned()
      .references('id').inTable('contacts')
      .onDelete('SET NULL');
    t.integer('tax_rate_id').unsigned()
      .references('id').inTable('tax_rates')
      .onDelete('SET NULL');
    t.text('memo');
    t.text('description');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['rule_id', 'sort_order']);
  });

  const client = String(knex.client.config.client || '').toLowerCase();
  await knex.schema.alterTable('bank_transactions', (t) => {
    if (client.includes('pg')) {
      t.specificType('create_proposal', 'jsonb');
    } else {
      t.json('create_proposal');
    }
    t.integer('create_proposal_rule_id').unsigned()
      .references('id').inTable('bank_matching_rules')
      .onDelete('SET NULL');
    t.text('create_proposal_rule_name');
    t.timestamp('create_proposal_created_at');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('bank_transactions', (t) => {
    t.dropColumn('create_proposal_created_at');
    t.dropColumn('create_proposal_rule_name');
    t.dropColumn('create_proposal_rule_id');
    t.dropColumn('create_proposal');
  });

  await knex.schema.dropTableIfExists('bank_matching_rule_splits');
  await knex.schema.dropTableIfExists('bank_matching_rules');
};
