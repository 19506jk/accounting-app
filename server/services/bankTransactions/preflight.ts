import type { Knex } from 'knex';

import type { BankTransactionRow } from '../../types/db';

export type ReconciliationReopenConflict = Pick<
  BankTransactionRow,
  'id' | 'matched_journal_entry_id' | 'status' | 'match_status' | 'lifecycle_status'
>;

export type ReconciliationReopenPreflightResult =
  | { blocked: false; conflicts: [] }
  | { blocked: true; conflicts: ReconciliationReopenConflict[] };

export async function reconciliationReopenPreflight(
  reconciliationId: number,
  trx: Knex | Knex.Transaction
): Promise<ReconciliationReopenPreflightResult> {
  const journalEntryIds = await trx('rec_items')
    .where({ reconciliation_id: reconciliationId })
    .pluck('journal_entry_id') as number[];

  if (journalEntryIds.length === 0) {
    return { blocked: false, conflicts: [] };
  }

  const conflicts = await trx('bank_transactions')
    .whereIn('matched_journal_entry_id', journalEntryIds)
    .where({ lifecycle_status: 'open', match_status: 'confirmed' })
    .select(
      'id',
      'matched_journal_entry_id',
      'status',
      'match_status',
      'lifecycle_status'
    ) as ReconciliationReopenConflict[];

  if (conflicts.length === 0) {
    return { blocked: false, conflicts: [] };
  }

  return { blocked: true, conflicts };
}
