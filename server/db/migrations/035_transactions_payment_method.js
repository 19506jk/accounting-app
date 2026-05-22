exports.up = (knex) =>
  knex.schema.table('transactions', (t) => {
    t.text('payment_method').nullable();
  });

exports.down = (knex) =>
  knex.schema.table('transactions', (t) => {
    t.dropColumn('payment_method');
  });
