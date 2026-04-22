exports.up = async function (knex) {
  await knex.schema.createTable('bank_uploads', (t) => {
    t.increments('id').primary();
    t.integer('account_id').unsigned().notNullable()
      .references('id').inTable('accounts')
      .onDelete('RESTRICT');
    t.integer('fund_id').unsigned().notNullable()
      .references('id').inTable('funds')
      .onDelete('RESTRICT');
    t.integer('uploaded_by').unsigned()
      .references('id').inTable('users')
      .onDelete('SET NULL');
    t.string('filename').notNullable();
    t.integer('row_count').notNullable();
    t.timestamp('imported_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('bank_transactions', (t) => {
    t.increments('id').primary();
    t.integer('upload_id').unsigned().notNullable()
      .references('id').inTable('bank_uploads')
      .onDelete('CASCADE');
    t.integer('row_index').notNullable();
    t.string('bank_transaction_id');
    t.date('bank_posted_date').notNullable();
    t.date('bank_effective_date');
    t.text('raw_description').notNullable();
    t.text('normalized_description').notNullable();
    t.decimal('amount', 15, 2).notNullable();
    t.string('fingerprint', 64).notNullable();
    t.enu('status', ['imported', 'needs_review', 'matched_existing', 'created_new', 'locked', 'archived'])
      .notNullable()
      .defaultTo('imported');
    t.integer('journal_entry_id').unsigned()
      .references('id').inTable('journal_entries')
      .onDelete('SET NULL');
    t.integer('reviewed_by').unsigned()
      .references('id').inTable('users')
      .onDelete('SET NULL');
    t.timestamp('reviewed_at');
    t.string('review_decision', 50);
    t.timestamp('imported_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_modified_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['upload_id', 'row_index']);
    t.index(['fingerprint']);
    t.index(['status']);
    t.index(['bank_posted_date']);
  });

  const client = String(knex.client.config.client || '').toLowerCase();
  if (client.includes('pg')) {
    await knex.schema.raw(`
      CREATE UNIQUE INDEX bank_transactions_bank_transaction_id_unique
      ON bank_transactions (bank_transaction_id)
      WHERE bank_transaction_id IS NOT NULL
    `);
  } else {
    await knex.schema.alterTable('bank_transactions', (t) => {
      t.unique(['bank_transaction_id'], 'bank_transactions_bank_transaction_id_unique');
    });
  }
};

exports.down = async function (knex) {
  const client = String(knex.client.config.client || '').toLowerCase();
  if (client.includes('pg')) {
    await knex.schema.raw('DROP INDEX IF EXISTS bank_transactions_bank_transaction_id_unique');
  } else {
    await knex.schema.alterTable('bank_transactions', (t) => {
      t.dropUnique(['bank_transaction_id'], 'bank_transactions_bank_transaction_id_unique');
    });
  }

  await knex.schema.dropTableIfExists('bank_transactions');
  await knex.schema.dropTableIfExists('bank_uploads');

  if (client.includes('pg')) {
    await knex.schema.raw("DROP TYPE IF EXISTS bank_transactions_status");
  }
};
