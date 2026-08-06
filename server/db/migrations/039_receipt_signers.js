/**
 * Migration 039 — receipt signers: branch accountant and treasurer
 *
 * Adds the two signer name settings and the treasurer signature image
 * setting. The branch accountant signature image reuses church_signature_url
 * (relabelled here); the settings seed applies the same keys and labels on
 * fresh installs. Schema-only, matching the migration convention of not
 * importing application modules.
 */

const SIGNER_SETTINGS = [
  { key: 'branch_accountant_name', label: 'Branch Accountant Name' },
  { key: 'treasurer_name', label: 'Treasurer Name' },
  { key: 'treasurer_signature_url', label: 'Treasurer Signature' },
];

exports.up = async function (knex) {
  for (const setting of SIGNER_SETTINGS) {
    const existing = await knex('settings').where({ key: setting.key }).first();
    if (!existing) {
      await knex('settings').insert({
        key: setting.key,
        label: setting.label,
        value: null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }
  await knex('settings')
    .where({ key: 'church_signature_url' })
    .update({ label: 'Branch Accountant Signature' });
};

exports.down = async function (knex) {
  await knex('settings')
    .whereIn('key', SIGNER_SETTINGS.map((setting) => setting.key))
    .del();
  await knex('settings')
    .where({ key: 'church_signature_url' })
    .update({ label: 'Authorized Signature Image URL' });
};
