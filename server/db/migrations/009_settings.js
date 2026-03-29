/**
 * Migration 009 — settings
 *
 * Key-value store for church-wide configuration.
 * Pre-seeded via 02_settings.js seed file.
 */

exports.up = function (knex) {
  return knex.schema.createTable('settings', (t) => {
    t.increments('id').primary();
    t.string('key').notNullable().unique();
    t.text('value');                    // nullable = not yet configured
    t.string('label').notNullable();    // human-readable label for UI
    t.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('settings');
};
