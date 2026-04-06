/**
 * Migration 020 — add church_timezone setting
 *
 * Adds canonical timezone configuration for business-date handling.
 */

exports.up = async function (knex) {
  const existing = await knex('settings').where({ key: 'church_timezone' }).first();
  if (!existing) {
    await knex('settings').insert({
      key: 'church_timezone',
      label: 'Church Timezone',
      value: 'America/Toronto',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }
};

exports.down = async function (knex) {
  await knex('settings').where({ key: 'church_timezone' }).delete();
};
