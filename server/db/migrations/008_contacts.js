/**
 * Migration 008 — contacts
 *
 * Tracks donors (individuals/households who give) and
 * payees (vendors/individuals the church pays).
 * A contact can be both DONOR and PAYEE.
 *
 * Also adds contact_id (nullable) to transactions.
 */

const PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'];

exports.up = async function (knex) {
  await knex.schema.createTable('contacts', (t) => {
    t.increments('id').primary();

    t.enum('type', ['DONOR', 'PAYEE', 'BOTH']).notNullable();
    t.enum('contact_class', ['INDIVIDUAL', 'HOUSEHOLD']).notNullable();

    // Display name — required for both classes
    // INDIVIDUAL: "John Smith"
    // HOUSEHOLD:  "John & Jane Smith" or "The Smith Family"
    t.string('name').notNullable();

    // Individual-specific (nullable for households)
    t.string('first_name');
    t.string('last_name');

    // Contact details
    t.string('email');
    t.string('phone');

    // Canadian address
    t.string('address_line1');
    t.string('address_line2');
    t.string('city');
    t.specificType('province', `VARCHAR(2) CHECK (province IS NULL OR province IN ('${PROVINCES.join("','")}'))`);
    t.string('postal_code', 7); // A1A 1A1

    t.text('notes');
    t.boolean('is_active').notNullable().defaultTo(true);

    t.timestamps(true, true);
  });

  // Add contact_id to transactions
  await knex.schema.alterTable('transactions', (t) => {
    t.integer('contact_id').unsigned().nullable()
      .references('id').inTable('contacts').onDelete('SET NULL');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('transactions', (t) => {
    t.dropColumn('contact_id');
  });
  await knex.schema.dropTable('contacts');
};
