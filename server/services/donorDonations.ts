import type { Knex } from 'knex';

import { normalizeDateOnly } from '../utils/date.js';

const db = require('../db') as Knex;

export type Numeric = string | number;

export interface DonationLineFilters {
  from?: string;
  to?: string;
  fundId?: string | number | null;
  accountIds?: number[] | null;
  contactId?: string | number | null;
  includeAnonymous?: boolean;
}

export interface DonationLineRow {
  contact_id: number | null;
  account_id: number;
  transaction_id: number;
  amount: Numeric;
  date: string | Date;
  description: string;
  reference_no: string | null;
  account_code: string;
  account_name: string;
  fund_name: string;
  memo: string | null;
}

export interface DonationLine {
  contact_id: number | null;
  account_id: number;
  transaction_id: number;
  amount: number;
  date: string;
  description: string;
  reference_no: string | null;
  account_code: string;
  account_name: string;
  fund_name: string;
  memo: string | null;
}

export async function getDonationLines({
  from,
  to,
  fundId,
  accountIds,
  contactId,
  includeAnonymous = true,
}: DonationLineFilters): Promise<DonationLine[]> {
  const rows = await db('transactions as t')
    .join('journal_entries as je', 'je.transaction_id', 't.id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .join('funds as f', 'f.id', 'je.fund_id')
    .where('t.is_voided', false)
    .where('t.is_closing_entry', false)
    .where('a.type', 'INCOME')
    .where('je.credit', '>', 0)
    .modify((query) => {
      if (from) query.where('t.date', '>=', from);
      if (to) query.where('t.date', '<=', to);
      if (fundId) query.where('je.fund_id', fundId);
      if (accountIds?.length) query.whereIn('a.id', accountIds);
      if (contactId) query.where('je.contact_id', contactId);
      if (!includeAnonymous) query.whereNotNull('je.contact_id');
    })
    .select(
      'je.contact_id',
      'a.id as account_id',
      't.id as transaction_id',
      't.date',
      't.description',
      't.reference_no',
      'a.code as account_code',
      'a.name as account_name',
      'f.name as fund_name',
      'je.credit as amount',
      'je.memo'
    )
    .orderBy('t.date', 'asc')
    .orderBy('t.id', 'asc') as DonationLineRow[];

  return rows.map((row) => ({
    ...row,
    date: normalizeDateOnly(row.date),
    amount: Number(row.amount),
  }));
}
