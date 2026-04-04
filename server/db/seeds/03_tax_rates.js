/**
 * Seed 03 — Tax Rates & Recoverable Accounts
 *
 * Inserts in order:
 *   1. HST Recoverable and GST Recoverable as ASSET accounts
 *   2. HST and GST tax rate records, linked to their recoverable accounts
 *
 * Idempotent — skips any record that already exists (matched by code/name).
 *
 * Account codes used:
 *   11800 — HST Recoverable
 *   11810 — GST Recoverable
 */

const RECOVERABLE_ACCOUNTS = [
  { code: '11800', name: 'HST Recoverable', type: 'ASSET' },
  { code: '11810', name: 'GST Recoverable', type: 'ASSET' },
];

const TAX_RATES = [
  { name: 'HST', rate: 0.1300, account_code: '11800' },
  { name: 'GST', rate: 0.0500, account_code: '11810' },
];

exports.seed = async function (knex) {
  // Step 1 — Insert recoverable accounts if they don't already exist
  for (const account of RECOVERABLE_ACCOUNTS) {
    const existing = await knex('accounts').where({ code: account.code }).first();
    if (!existing) {
      await knex('accounts').insert({
        code:       account.code,
        name:       account.name,
        type:       account.type,
        is_active:  true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }

  // Step 2 — Insert tax rates, linking each to its recoverable account
  for (const taxRate of TAX_RATES) {
    const existing = await knex('tax_rates').where({ name: taxRate.name }).first();
    if (!existing) {
      const account = await knex('accounts').where({ code: taxRate.account_code }).first();
      if (!account) {
        throw new Error(
          `Seed 03: Could not find account with code ${taxRate.account_code} ` +
          `for tax rate "${taxRate.name}". Ensure accounts were inserted in Step 1.`
        );
      }
      await knex('tax_rates').insert({
        name:                   taxRate.name,
        rate:                   taxRate.rate,
        recoverable_account_id: account.id,
        rebate_percentage:      1.0000,
        is_active:              true,
        created_at:             knex.fn.now(),
        updated_at:             knex.fn.now(),
      });
    }
  }
};
