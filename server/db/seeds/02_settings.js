/**
 * Seed — Church Settings
 *
 * Pre-loads all setting keys with empty values.
 * Admin fills these in via Settings page in the UI.
 * Idempotent — skips keys that already exist.
 */

const SETTINGS = [
  { key: 'church_name',            label: 'Church Name' },
  { key: 'church_address_line1',   label: 'Address Line 1' },
  { key: 'church_address_line2',   label: 'Address Line 2' },
  { key: 'church_city',            label: 'City' },
  { key: 'church_province',        label: 'Province' },
  { key: 'church_postal_code',     label: 'Postal Code' },
  { key: 'church_phone',           label: 'Phone' },
  { key: 'church_email',           label: 'Email' },
  { key: 'church_registration_no', label: 'CRA Charitable Registration #' },
  { key: 'church_signature_url',  label: 'Authorized Signature Image URL' },
  { key: 'fiscal_year_start',      label: 'Fiscal Year Start Month', value: '1' },
  { key: 'currency',               label: 'Currency',                value: 'CAD' },
];

exports.seed = async function (knex) {
  for (const setting of SETTINGS) {
    const existing = await knex('settings').where({ key: setting.key }).first();
    if (!existing) {
      await knex('settings').insert({
        key:        setting.key,
        label:      setting.label,
        value:      setting.value || null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }
};
