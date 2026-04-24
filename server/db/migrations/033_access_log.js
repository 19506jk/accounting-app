exports.up = async function (knex) {
  await knex.schema.createTable('access_log', (t) => {
    t.bigIncrements('id').primary();
    t.uuid('session_token').notNullable();
    t.integer('actor_id').unsigned().nullable();
    t.string('actor_email', 255).nullable();
    t.string('request_method', 10).notNullable();
    t.string('request_path', 500).notNullable();
    t.string('ip_address', 45).nullable();
    t.text('user_agent').nullable();
    t.integer('http_status').nullable();
    t.string('outcome', 20).notNullable().defaultTo('pending');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['session_token']);
    t.index(['actor_id']);
    t.index(['created_at']);
    t.index(['outcome']);
  });

  await knex.raw(`
    CREATE RULE access_log_no_update AS ON UPDATE TO access_log DO INSTEAD NOTHING;
    CREATE RULE access_log_no_delete AS ON DELETE TO access_log DO INSTEAD NOTHING;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DROP RULE IF EXISTS access_log_no_update ON access_log;
    DROP RULE IF EXISTS access_log_no_delete ON access_log;
  `);

  await knex.schema.dropTableIfExists('access_log');
};
