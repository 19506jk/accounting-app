exports.up = async function (knex) {
  await knex.schema.alterTable('bank_transactions', (t) => {
    t.string('disposition', 10).notNullable().defaultTo('none');
  });

  await knex.schema.alterTable('bank_transaction_events', (t) => {
    t.text('reason_note');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('bank_transaction_events', (t) => {
    t.dropColumn('reason_note');
  });

  await knex.schema.alterTable('bank_transactions', (t) => {
    t.dropColumn('disposition');
  });
};
