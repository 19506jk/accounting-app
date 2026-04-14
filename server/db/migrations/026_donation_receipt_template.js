exports.up = async function (knex) {
  await knex.schema.createTable('donation_receipt_templates', (t) => {
    t.increments('id').primary();
    t.text('markdown_body').notNullable();
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('donation_receipt_templates');
};
