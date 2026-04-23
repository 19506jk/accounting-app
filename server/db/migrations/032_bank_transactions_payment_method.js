exports.up = async function (knex) {
  await knex.schema.table('bank_transactions', (t) => {
    t.text('payment_method').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.table('bank_transactions', (t) => {
    t.dropColumn('payment_method');
  });
};
