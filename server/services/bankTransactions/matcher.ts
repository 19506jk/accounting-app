import type { Knex } from 'knex';

import type {
  BankMatchResult,
  MatchCandidate,
} from '@shared/contracts';
import type {
  BankTransactionRow,
  ReconciliationReservationRow,
} from '../../types/db';
import { normalizeDescription } from './normalize.js';
import { acquireReservation, releaseReservation } from './reservations.js';

type JoinedBankTransactionRow = BankTransactionRow & {
  account_id: number;
};

type CandidateRow = {
  journal_entry_id: number;
  transaction_id: number;
  date: string;
  description: string;
  reference_no: string | null;
  debit: string | number;
  credit: string | number;
};

type EventActor = 'user' | 'system' | 'admin';

function toNumber(value: string | number | null | undefined) {
  return Number.parseFloat(String(value ?? 0));
}

function toDateOnly(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  throw new Error(`Invalid date value: ${raw}`);
}

function addDays(dateOnly: string, days: number) {
  const dt = new Date(`${dateOnly}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function daysBetween(dateA: string, dateB: string) {
  const start = new Date(`${dateA}T00:00:00.000Z`).getTime();
  const end = new Date(`${dateB}T00:00:00.000Z`).getTime();
  return Math.round((start - end) / 86400000);
}

function normalizeRef(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function scoreRef(bankTxId: string | null, refNo: string | null): number {
  if (!bankTxId || !refNo) return 0;
  return normalizeRef(bankTxId) === normalizeRef(refNo) ? 100 : 0;
}

export function scoreDate(bankDate: string, txDate: string): number {
  const diff = Math.abs(daysBetween(bankDate, txDate));
  return Math.max(0, 100 - diff * 20);
}

export function scoreDesc(normalizedBankDesc: string, txDesc: string): number {
  const normalizedTx = normalizeDescription(txDesc);
  const tokensBank = new Set(normalizedBankDesc.split(' ').filter(Boolean));
  const tokensTx = new Set(normalizedTx.split(' ').filter(Boolean));
  if (tokensBank.size === 0 && tokensTx.size === 0) return 100;
  if (tokensBank.size === 0 || tokensTx.size === 0) return 0;
  const intersection = [...tokensBank].filter((token) => tokensTx.has(token)).length;
  const union = new Set([...tokensBank, ...tokensTx]).size;
  return Math.round((intersection / union) * 100);
}

function scoreTotal(scoreRefValue: number, scoreDateValue: number, scoreDescValue: number) {
  return Math.round(((0.5 * scoreRefValue) + (0.3 * scoreDateValue) + (0.2 * scoreDescValue)) * 100) / 100;
}

function eventPayload(bankTransactionId: number | null, payload: Record<string, unknown> = {}) {
  return JSON.stringify({
    bank_transaction_id: bankTransactionId,
    ...payload,
  });
}

export async function writeBankTransactionEvent({
  trx,
  bankTransactionId,
  eventType,
  actorType,
  actorId,
  payload,
  reasonNote,
}: {
  trx: Knex.Transaction;
  bankTransactionId: number | null;
  eventType: string;
  actorType: EventActor;
  actorId: number | null;
  payload?: Record<string, unknown>;
  reasonNote?: string | null;
}) {
  await trx('bank_transaction_events').insert({
    bank_transaction_id: bankTransactionId,
    event_type: eventType,
    actor_type: actorType,
    actor_id: actorId,
    payload: payload ? eventPayload(bankTransactionId, payload) : null,
    reason_note: reasonNote ?? null,
    created_at: trx.fn.now(),
  });
}

async function loadBankTransaction(
  bankTransactionId: number,
  trx: Knex.Transaction
): Promise<JoinedBankTransactionRow | undefined> {
  return trx('bank_transactions as bt')
    .join('bank_uploads as bu', 'bu.id', 'bt.upload_id')
    .where('bt.id', bankTransactionId)
    .select('bt.*', 'bu.account_id')
    .first() as Promise<JoinedBankTransactionRow | undefined>;
}

async function getUpdatedBankTransaction(
  bankTransactionId: number,
  trx: Knex.Transaction
) {
  return trx('bank_transactions')
    .where({ id: bankTransactionId })
    .first() as Promise<BankTransactionRow | undefined>;
}

export async function confirmMatch(
  bankTransactionId: number,
  journalEntryId: number,
  source: 'system' | 'human',
  userId: number | null,
  trx: Knex.Transaction
) {
  const bankTx = await trx('bank_transactions')
    .where({ id: bankTransactionId })
    .first() as BankTransactionRow | undefined;

  if (!bankTx) {
    const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const existingClaim = await trx('bank_transactions')
    .where({ matched_journal_entry_id: journalEntryId, match_status: 'confirmed' })
    .where('lifecycle_status', '<>', 'archived')
    .whereNot({ id: bankTransactionId })
    .first() as { id: number } | undefined;
  if (existingClaim) {
    const err = new Error('Journal entry is already claimed by another bank transaction') as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  if (source === 'human') {
    const reservation = await trx('reconciliation_reservations')
      .where({
        journal_entry_id: journalEntryId,
        bank_transaction_id: bankTransactionId,
      })
      .where('expires_at', '>', trx.fn.now())
      .first() as ReconciliationReservationRow | undefined;

    if (!reservation) {
      const err = new Error('Reservation missing or held by another bank transaction') as Error & { statusCode?: number };
      err.statusCode = 409;
      throw err;
    }
  } else {
    const reservationResult = await acquireReservation(journalEntryId, bankTransactionId, userId, trx);
    if (!reservationResult.acquired) {
      return null;
    }
  }

  await trx('bank_transactions')
    .where({ id: bankTransactionId })
    .update({
      match_status: 'confirmed',
      match_source: source,
      review_status: source === 'system' ? 'pending' : 'reviewed',
      matched_journal_entry_id: journalEntryId,
      status: 'matched_existing',
      journal_entry_id: journalEntryId,
      last_modified_at: trx.fn.now(),
    });

  await releaseReservation(journalEntryId, bankTransactionId, trx);

  await writeBankTransactionEvent({
    trx,
    bankTransactionId,
    eventType: 'match_confirmed',
    actorType: source === 'system' ? 'system' : 'user',
    actorId: source === 'system' ? null : userId,
    payload: {
      journal_entry_id: journalEntryId,
      source,
    },
  });

  return getUpdatedBankTransaction(bankTransactionId, trx);
}

export async function runMatcher(
  bankTransactionId: number,
  userId: number | null,
  trx: Knex.Transaction
): Promise<BankMatchResult> {
  const bankTx = await loadBankTransaction(bankTransactionId, trx);
  if (!bankTx) {
    const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  if (
    bankTx.match_status === 'confirmed'
    || bankTx.lifecycle_status !== 'open'
    || bankTx.status === 'needs_review'
  ) {
    return {
      bank_transaction_id: bankTransactionId,
      candidates: [],
      auto_confirmed: null,
    };
  }

  const amount = toNumber(bankTx.amount);
  const absAmount = Math.abs(amount).toFixed(2);
  const fromDate = addDays(toDateOnly(bankTx.bank_posted_date), -7);
  const toDate = addDays(toDateOnly(bankTx.bank_posted_date), 7);

  const query = trx('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .where('je.account_id', bankTx.account_id)
    .where('je.is_reconciled', false)
    .where('t.is_voided', false)
    .whereBetween('t.date', [fromDate, toDate])
    .whereNotExists(
      trx('bank_transactions as bt2')
        .select(trx.raw('1'))
        .whereRaw('bt2.matched_journal_entry_id = je.id')
        .andWhereRaw("bt2.lifecycle_status <> 'archived'")
        .andWhere('bt2.match_status', 'confirmed')
    )
    .whereNotExists(
      trx('reconciliation_reservations as r')
        .select(trx.raw('1'))
        .whereRaw('r.journal_entry_id = je.id')
        .andWhere('r.bank_transaction_id', '<>', bankTransactionId)
        .andWhere('r.expires_at', '>', trx.fn.now())
    )
    .whereNotExists(
      trx('bank_transaction_rejections as btr')
        .select(trx.raw('1'))
        .whereRaw('btr.journal_entry_id = je.id')
        .andWhere('btr.bank_transaction_id', bankTransactionId)
    )
    .select(
      'je.id as journal_entry_id',
      'je.transaction_id',
      't.date',
      't.description',
      't.reference_no',
      'je.debit',
      'je.credit'
    )
    .limit(50);

  if (amount > 0) {
    query.andWhereRaw('CAST(je.debit AS DECIMAL(15,2)) = ?', [absAmount]);
  } else {
    query.andWhereRaw('CAST(je.credit AS DECIMAL(15,2)) = ?', [absAmount]);
  }

  const rows = await query as CandidateRow[];
  if (rows.length === 0) {
    await trx('bank_transactions')
      .where({ id: bankTransactionId })
      .update({
        suggested_match_id: null,
        match_status: 'rejected',
        last_modified_at: trx.fn.now(),
      });

    await writeBankTransactionEvent({
      trx,
      bankTransactionId,
      eventType: 'match_exhausted',
      actorType: userId ? 'user' : 'system',
      actorId: userId,
      payload: { reason: 'no_candidates' },
    });

    return {
      bank_transaction_id: bankTransactionId,
      candidates: [],
      auto_confirmed: null,
    };
  }

  const scored = rows.map((row) => {
    const rowDate = toDateOnly(row.date);
    const sRef = scoreRef(bankTx.bank_transaction_id, row.reference_no);
    const sDate = scoreDate(toDateOnly(bankTx.bank_posted_date), rowDate);
    const sDesc = scoreDesc(bankTx.normalized_description, row.description);
    const total = scoreTotal(sRef, sDate, sDesc);
    return {
      journal_entry_id: row.journal_entry_id,
      transaction_id: row.transaction_id,
      date: rowDate,
      description: row.description,
      reference_no: row.reference_no,
      amount: Math.abs(amount),
      direction: amount > 0 ? 'debit' : 'credit',
      score_total: total,
      score_ref: sRef,
      score_date: sDate,
      score_desc: sDesc,
      auto_confirm_eligible: false,
    } as MatchCandidate;
  }).sort((a, b) => b.score_total - a.score_total);

  const top = scored[0];
  if (!top) {
    return {
      bank_transaction_id: bankTransactionId,
      candidates: [],
      auto_confirmed: null,
    };
  }
  const second = scored[1];
  const margin = second ? top.score_total - second.score_total : 100;
  const refProof = top.score_ref === 100 && top.score_total >= 95 && margin >= 10;
  const perfectDateDescProof = top.score_date === 100 && top.score_desc >= 85 && margin >= 10;
  const autoConfirmEligible = refProof || perfectDateDescProof;
  top.auto_confirm_eligible = autoConfirmEligible;

  await trx('bank_transactions')
    .where({ id: bankTransactionId })
    .update({
      suggested_match_id: top.journal_entry_id,
      match_status: 'suggested',
      last_modified_at: trx.fn.now(),
    });

  await writeBankTransactionEvent({
    trx,
    bankTransactionId,
    eventType: 'match_suggested',
    actorType: userId ? 'user' : 'system',
    actorId: userId,
    payload: {
      journal_entry_id: top.journal_entry_id,
      score_total: top.score_total,
      score_ref: top.score_ref,
      score_date: top.score_date,
      score_desc: top.score_desc,
    },
  });

  let autoConfirmed: MatchCandidate | null = null;
  if (autoConfirmEligible) {
    const confirmed = await confirmMatch(bankTransactionId, top.journal_entry_id, 'system', userId, trx);
    if (confirmed) {
      autoConfirmed = top;
    }
  }

  return {
    bank_transaction_id: bankTransactionId,
    candidates: scored,
    auto_confirmed: autoConfirmed,
  };
}
