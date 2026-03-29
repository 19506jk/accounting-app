/**
 * Migration 003 — accounts (Chart of Accounts)
 *
 * Account types follow standard double-entry bookkeeping:
 *   ASSET      — things the church owns (bank accounts, cash)
 *   LIABILITY  — things the church owes (payables, designated funds held)
 *   EQUITY     — net worth / fund balances
 *   INCOME     — money coming in (offerings, donations)
 *   EXPENSE    — money going out (salaries, utilities)
 *
 * parent_id enables sub-accounts (e.g. 5000 Salaries → 5000a Pastoral, 5000b Staff).
 * fund_id optionally ties an account to a specific fund.
 *
 * Accounts are NEVER hard-deleted — soft-delete via is_active to preserve history.
 */

exports.up = function (knex) {
  return knex.schema.createTable('accounts', (t) => {
    t.increments('id').primary();

    // e.g. "4001", "5052" — unique identifier used in the Chart of Accounts
    t.string('code').notNullable().unique();
    t.string('name').notNullable();

    t.enum('type', ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']).notNullable();

    // Optional fund association
    t.integer('fund_id').unsigned().references('id').inTable('funds').onDelete('SET NULL');

    // Optional parent for sub-account hierarchy
    t.integer('parent_id').unsigned().references('id').inTable('accounts').onDelete('SET NULL');

    // Soft delete — never remove accounts that have transaction history
    t.boolean('is_active').notNullable().defaultTo(true);

    t.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('accounts');
};
