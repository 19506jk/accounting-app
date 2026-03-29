/**
 * Seed — Chart of Accounts
 *
 * Pre-loads the standard church accounts so the app is useful on day one.
 * Accounts are inserted in code-order within each type.
 *
 * To re-run safely: existing accounts (matched by code) are left untouched.
 */

const ACCOUNTS = [
  // ── ASSETS ──────────────────────────────────────────────────────────────
  { code: '1000', name: 'Checking Account',    type: 'ASSET' },
  { code: '1010', name: 'Savings Account',     type: 'ASSET' },
  { code: '1020', name: 'Petty Cash',          type: 'ASSET' },

  // ── LIABILITIES ─────────────────────────────────────────────────────────
  { code: '2000', name: 'Accounts Payable',        type: 'LIABILITY' },
  { code: '2010', name: 'Designated Funds Held',   type: 'LIABILITY' },

  // ── EQUITY ──────────────────────────────────────────────────────────────
  { code: '3090', name: 'Building Fund',       type: 'EQUITY' },

  // ── INCOME ──────────────────────────────────────────────────────────────
  { code: '4001', name: 'Regular Offering',        type: 'INCOME' },
  { code: '4101', name: 'Collection - Retreat',    type: 'INCOME' },
  { code: '4105', name: 'Collection - Sunday Meals', type: 'INCOME' },
  { code: '4301', name: 'Missionary Funds',        type: 'INCOME' },
  { code: '4401', name: 'Retreat Offering',        type: 'INCOME' },
  { code: '4801', name: 'Bank Interest',           type: 'INCOME' },

  // ── EXPENSES ────────────────────────────────────────────────────────────
  { code: '5052', name: 'Gas Subsidies',       type: 'EXPENSE' },
  { code: '5111', name: 'Retreat Food',        type: 'EXPENSE' },
];

exports.seed = async function (knex) {
  for (const account of ACCOUNTS) {
    const existing = await knex('accounts').where({ code: account.code }).first();
    if (!existing) {
      await knex('accounts').insert({
        ...account,
        is_active:  true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }
};
