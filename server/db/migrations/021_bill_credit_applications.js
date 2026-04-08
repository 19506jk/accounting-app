exports.up = async function (knex) {
  await knex.schema.raw('ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_amount_paid_abs_limit_check');
  await knex.schema.raw('ALTER TABLE bills ADD CONSTRAINT bills_amount_paid_abs_limit_check CHECK (ABS(amount_paid) <= ABS(amount))');

  await knex.schema.createTable('bill_credit_applications', (t) => {
    t.increments('id').primary();
    t
      .integer('target_bill_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('bills')
      .onDelete('CASCADE');
    t
      .integer('credit_bill_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('bills')
      .onDelete('CASCADE');
    t.decimal('amount', 15, 2).notNullable();
    t
      .integer('apply_transaction_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('transactions')
      .onDelete('SET NULL');
    t
      .integer('applied_by')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    t.timestamp('applied_at').notNullable().defaultTo(knex.fn.now());
    t.integer('unapplied_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('unapplied_at').nullable();

    t.index(['target_bill_id']);
    t.index(['credit_bill_id']);
    t.index(['applied_at']);
    t.unique(['target_bill_id', 'credit_bill_id', 'apply_transaction_id'], {
      indexName: 'bill_credit_apps_target_credit_txn_unique',
    });
  });

  await knex.schema.raw(
    'ALTER TABLE bill_credit_applications ADD CONSTRAINT bill_credit_apps_not_same_bill_check CHECK (target_bill_id <> credit_bill_id)'
  );
  await knex.schema.raw(
    'ALTER TABLE bill_credit_applications ADD CONSTRAINT bill_credit_apps_positive_amount_check CHECK (amount > 0)'
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('bill_credit_applications');
  await knex.schema.raw('ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_amount_paid_abs_limit_check');
};
