/**
 * Migration 038 — donation receipt templates: add html_body
 *
 * Moves template authoring from Markdown to sanitized HTML fragments.
 * Schema-only: legacy markdown_body is retained (nullable) and converted
 * lazily at runtime by the receipt service, so no application modules or
 * `marked` are imported here.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('donation_receipt_templates', (t) => {
    t.text('html_body').nullable();
  });

  await knex.schema.alterTable('donation_receipt_templates', (t) => {
    t.text('markdown_body').nullable().alter();
  });
};

exports.down = async function (knex) {
  // HTML-only edits (rows saved after migration) are intentionally lost,
  // matching the repository's rollback convention for migrated data.
  await knex('donation_receipt_templates').whereNull('markdown_body').del();

  await knex.schema.alterTable('donation_receipt_templates', (t) => {
    t.dropColumn('html_body');
  });

  await knex.schema.alterTable('donation_receipt_templates', (t) => {
    t.text('markdown_body').notNullable().alter();
  });
};
