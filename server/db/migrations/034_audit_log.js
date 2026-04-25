exports.up = async function (knex) {
  await knex.schema.createTable('audit_log', (t) => {
    t.bigIncrements('id').primary();
    t.uuid('session_token').nullable();
    t.string('entity_type', 50).notNullable();
    t.string('entity_id', 50).notNullable();
    t.string('entity_label', 255).nullable();
    t.string('action', 30).notNullable();
    t.jsonb('payload').nullable();
    t.text('reason_note').nullable();
    t.integer('actor_id').unsigned().nullable();
    t.string('actor_name', 255).notNullable();
    t.string('actor_email', 255).notNullable();
    t.string('actor_role', 20).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['session_token']);
    t.index(['entity_type', 'entity_id']);
    t.index(['actor_id']);
    t.index(['action']);
    t.index(['created_at']);
  });

  await knex.raw(`
    CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
    CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP RULE IF EXISTS audit_log_no_update ON audit_log;
    DROP RULE IF EXISTS audit_log_no_delete ON audit_log;
  `);

  await knex.schema.dropTableIfExists('audit_log');
};
