/**
 * Migration 009 — add donor_id to contacts
 *
 * donor_id is a free-form string identifier unique across all contacts.
 * It is required at the application level for contacts of type DONOR or BOTH,
 * but nullable at the DB level to allow PAYEE-only contacts to omit it.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('contacts', (t) => {
    t.string('donor_id').nullable().unique();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('contacts', (t) => {
    t.dropColumn('donor_id');
  });
};
