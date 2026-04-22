import type { Knex } from 'knex';

import type { ReconciliationReservationRow } from '../../types/db';

const RESERVATION_TTL_MINUTES = 20;

function nextExpiryDate() {
  return new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
}

function isUniqueViolation(err: unknown) {
  const code = (err as { code?: string }).code;
  const message = (err as { message?: string }).message || '';
  return code === '23505'
    || code === 'SQLITE_CONSTRAINT'
    || code === 'ER_DUP_ENTRY'
    || message.toLowerCase().includes('unique');
}

export type AcquireReservationResult = {
  acquired: boolean;
  released: number[];
};

export async function acquireReservation(
  journalEntryId: number,
  bankTransactionId: number,
  userId: number | null,
  trx: Knex.Transaction
): Promise<AcquireReservationResult> {
  const existingOwned = await trx('reconciliation_reservations')
    .where({
      journal_entry_id: journalEntryId,
      bank_transaction_id: bankTransactionId,
    })
    .where('expires_at', '>', trx.fn.now())
    .first() as ReconciliationReservationRow | undefined;

  if (existingOwned) {
    await trx('reconciliation_reservations')
      .where({ id: existingOwned.id })
      .update({
        expires_at: nextExpiryDate(),
      });

    return { acquired: true, released: [] };
  }

  const priorRows = await trx('reconciliation_reservations')
    .where({ bank_transaction_id: bankTransactionId })
    .whereNot({ journal_entry_id: journalEntryId })
    .select('journal_entry_id') as Array<{ journal_entry_id: number }>;
  const released = priorRows.map((row) => row.journal_entry_id);

  if (released.length > 0) {
    await trx('reconciliation_reservations')
      .whereIn('journal_entry_id', released)
      .where({ bank_transaction_id: bankTransactionId })
      .delete();
  }

  await trx('reconciliation_reservations')
    .where({ journal_entry_id: journalEntryId })
    .where('expires_at', '<=', trx.fn.now())
    .delete();

  try {
    await trx('reconciliation_reservations').insert({
      journal_entry_id: journalEntryId,
      bank_transaction_id: bankTransactionId,
      reserved_by: userId,
      reserved_at: trx.fn.now(),
      expires_at: nextExpiryDate(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { acquired: false, released };
    }
    throw err;
  }

  return { acquired: true, released };
}

export async function releaseReservation(
  journalEntryId: number,
  bankTransactionId: number | null,
  trx: Knex.Transaction
) {
  const query = trx('reconciliation_reservations').where({ journal_entry_id: journalEntryId });
  if (bankTransactionId !== null) {
    query.andWhere({ bank_transaction_id: bankTransactionId });
  }
  await query.delete();
}
