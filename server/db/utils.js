/**
 * Database utilities
 *
 * Shared helper functions for Knex queries
 */

/**
 * Returns a query for active (non-voided) journal entries only.
 * This filters out any journal entries associated with voided transactions.
 *
 * Usage:
 *   const { activeEntries } = require('./utils');
 *   const entries = await activeEntries(db)
 *     .where('journal_entries.account_id', accountId)
 *     .select('journal_entries.*', 'transactions.date');
 *
 * @param {Knex} db - Knex instance
 * @returns {Knex.QueryBuilder}
 */
function activeEntries(db) {
  return db('journal_entries')
    .join('transactions', 'journal_entries.transaction_id', 'transactions.id')
    .where('transactions.is_voided', false)
    .select('journal_entries.*');
}

module.exports = { activeEntries };
