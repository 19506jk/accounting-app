exports.up = async function (knex) {
  await knex.schema.table('bank_transactions', (t) => {
    t.text('sender_name').nullable();
    t.text('sender_email').nullable();
    t.text('bank_description_2').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.table('bank_transactions', (t) => {
    t.dropColumn('sender_name');
    t.dropColumn('sender_email');
    t.dropColumn('bank_description_2');
  });
};
