import type { Knex } from 'knex';

import type { BankTransactionRow } from '../../types/db';
import { releaseReservation } from './reservations.js';

export function isResolved(row: BankTransactionRow): boolean {
  if (row.disposition === 'ignored') return true;
  if (row.match_status === 'confirmed' && row.creation_status === 'none' && row.review_status === 'reviewed') return true;
  if (row.creation_status === 'created' && row.review_status === 'reviewed') return true;
  return false;
}

export async function resetRowState(bankTxId: number, trx: Knex.Transaction): Promise<void> {
  const reservation = await trx('reconciliation_reservations')
    .where({ bank_transaction_id: bankTxId })
    .first() as { journal_entry_id: number } | undefined;

  if (reservation) {
    await releaseReservation(reservation.journal_entry_id, bankTxId, trx);
  }

  await trx('bank_transactions')
    .where({ id: bankTxId })
    .update({
      disposition: 'none',
      match_status: 'none',
      creation_status: 'none',
      review_status: 'pending',
      match_source: null,
      creation_source: null,
      suggested_match_id: null,
      matched_journal_entry_id: null,
      status: 'imported',
      journal_entry_id: null,
      reviewed_by: null,
      reviewed_at: null,
      review_decision: null,
      last_modified_at: trx.fn.now(),
    });
}
