exports.up = async function (knex) {
  await knex.schema.alterTable('bank_transactions', (t) => {
    t.string('lifecycle_status', 10).notNullable().defaultTo('open');
    t.string('match_status', 20).notNullable().defaultTo('none');
    t.string('creation_status', 20).notNullable().defaultTo('none');
    t.string('review_status', 10).notNullable().defaultTo('pending');
    t.string('match_source', 10);
    t.string('creation_source', 10);
    t.integer('suggested_match_id').unsigned()
      .references('id').inTable('journal_entries')
      .onDelete('SET NULL');
    t.integer('matched_journal_entry_id').unsigned()
      .references('id').inTable('journal_entries')
      .onDelete('SET NULL');
  });

  await knex.schema.createTable('reconciliation_reservations', (t) => {
    t.increments('id').primary();
    t.integer('journal_entry_id').unsigned().notNullable()
      .references('id').inTable('journal_entries')
      .onDelete('CASCADE')
      .unique();
    t.integer('bank_transaction_id').unsigned().notNullable()
      .references('id').inTable('bank_transactions')
      .onDelete('CASCADE');
    t.integer('reserved_by').unsigned()
      .references('id').inTable('users')
      .onDelete('SET NULL');
    t.timestamp('reserved_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable();
    t.index(['bank_transaction_id']);
    t.index(['expires_at']);
  });

  await knex.schema.createTable('bank_transaction_events', (t) => {
    t.increments('id').primary();
    t.integer('bank_transaction_id').unsigned()
      .references('id').inTable('bank_transactions')
      .onDelete('SET NULL');
    t.string('event_type', 50).notNullable();
    t.string('actor_type', 10).notNullable();
    t.integer('actor_id').unsigned()
      .references('id').inTable('users')
      .onDelete('SET NULL');
    t.text('payload');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['bank_transaction_id']);
  });

  await knex.schema.createTable('bank_transaction_rejections', (t) => {
    t.increments('id').primary();
    t.integer('bank_transaction_id').unsigned().notNullable()
      .references('id').inTable('bank_transactions')
      .onDelete('CASCADE');
    t.integer('journal_entry_id').unsigned().notNullable()
      .references('id').inTable('journal_entries')
      .onDelete('CASCADE');
    t.integer('rejected_by').unsigned()
      .references('id').inTable('users')
      .onDelete('SET NULL');
    t.timestamp('rejected_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['bank_transaction_id', 'journal_entry_id']);
    t.index(['journal_entry_id']);
  });

  const client = String(knex.client.config.client || '').toLowerCase();
  if (client.includes('pg') || client.includes('sqlite')) {
    await knex.schema.raw(`
      CREATE UNIQUE INDEX idx_unique_active_claim
      ON bank_transactions (matched_journal_entry_id)
      WHERE matched_journal_entry_id IS NOT NULL
        AND lifecycle_status <> 'archived'
        AND match_status = 'confirmed'
    `);
  }
};

exports.down = async function (knex) {
  const client = String(knex.client.config.client || '').toLowerCase();
  if (client.includes('pg') || client.includes('sqlite')) {
    await knex.schema.raw('DROP INDEX IF EXISTS idx_unique_active_claim');
  }

  await knex.schema.dropTableIfExists('bank_transaction_rejections');
  await knex.schema.dropTableIfExists('bank_transaction_events');
  await knex.schema.dropTableIfExists('reconciliation_reservations');

  await knex.schema.alterTable('bank_transactions', (t) => {
    t.dropColumn('matched_journal_entry_id');
    t.dropColumn('suggested_match_id');
    t.dropColumn('creation_source');
    t.dropColumn('match_source');
    t.dropColumn('review_status');
    t.dropColumn('creation_status');
    t.dropColumn('match_status');
    t.dropColumn('lifecycle_status');
  });
};
