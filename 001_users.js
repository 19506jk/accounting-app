/**
 * Migration 001 — users
 * Stores Google-authenticated users and their app roles.
 * No password_hash — identity is fully delegated to Google OAuth.
 */

exports.up = function (knex) {
  return knex.schema.createTable('users', (t) => {
    t.increments('id').primary();

    // Google identity
    t.string('google_id').notNullable().unique();
    t.string('email').notNullable().unique();
    t.string('name').notNullable();
    t.string('avatar_url');

    // Access control
    t.enum('role', ['admin', 'editor', 'viewer']).notNullable().defaultTo('viewer');
    t.boolean('is_active').notNullable().defaultTo(true);

    t.timestamps(true, true); // created_at, updated_at
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('users');
};
