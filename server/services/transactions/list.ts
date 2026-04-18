import type { Knex } from 'knex';

import type {
  TransactionListItem,
  TransactionsListResponse,
  TransactionsQuery,
} from '@shared/contracts';
import type {
  TransactionListRow,
} from '../../types/db';
import { normalizeDateOnly, parseDateOnlyStrict } from '../../utils/date.js';

const db = require('../../db') as Knex;

type TransactionType = NonNullable<TransactionsQuery['transaction_type']>;

type TransactionPageRow = Omit<TransactionListRow, 'contact_name' | 'has_multiple_contacts' | 'total_amount'>;

type TransactionAggregateRow = {
  transaction_id: number;
  total_amount: string | number | null;
  contact_count: string | number | null;
  contact_name: string | null;
  has_income_credit: string | number | null;
  has_expense_debit: string | number | null;
};

const validTransactionTypes: TransactionType[] = ['deposit', 'withdrawal', 'transfer'];

function badRequest(message: string) {
  return Object.assign(new Error(message), {
    status: 400,
    statusCode: 400,
  });
}

function applyTransactionFilters(
  q: Knex.QueryBuilder,
  filters: {
    fund_id?: TransactionsQuery['fund_id'];
    account_id?: TransactionsQuery['account_id'];
    contact_id?: TransactionsQuery['contact_id'];
    includeInactive: boolean;
    transaction_type?: TransactionsQuery['transaction_type'];
    from?: TransactionsQuery['from'];
    to?: TransactionsQuery['to'];
  }
) {
  const {
    fund_id,
    account_id,
    contact_id,
    includeInactive,
    transaction_type,
    from,
    to,
  } = filters;

  if (!includeInactive) q.where('t.is_voided', false);
  if (fund_id) q.where('t.fund_id', fund_id);
  if (from) q.where('t.date', '>=', from);
  if (to) q.where('t.date', '<=', to);
  if (account_id) {
    q.whereExists(
      db('journal_entries as je')
        .where('je.transaction_id', db.raw('t.id'))
        .where('je.account_id', account_id)
    );
  }
  if (contact_id) {
    q.whereExists(
      db('journal_entries as je')
        .where('je.transaction_id', db.raw('t.id'))
        .where('je.contact_id', contact_id)
    );
  }
  if (transaction_type === 'deposit') {
    q.whereExists(
      db('journal_entries as je_type_filter')
        .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
        .where('je_type_filter.transaction_id', db.raw('t.id'))
        .where('a_type_filter.type', 'INCOME')
        .where('je_type_filter.credit', '>', 0)
    );
  }
  if (transaction_type === 'withdrawal') {
    q.whereNotExists(
      db('journal_entries as je_type_filter')
        .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
        .where('je_type_filter.transaction_id', db.raw('t.id'))
        .where('a_type_filter.type', 'INCOME')
        .where('je_type_filter.credit', '>', 0)
    ).whereExists(
      db('journal_entries as je_type_filter')
        .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
        .where('je_type_filter.transaction_id', db.raw('t.id'))
        .where('a_type_filter.type', 'EXPENSE')
        .where('je_type_filter.debit', '>', 0)
    );
  }
  if (transaction_type === 'transfer') {
    q.whereNotExists(
      db('journal_entries as je_type_filter')
        .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
        .where('je_type_filter.transaction_id', db.raw('t.id'))
        .where('a_type_filter.type', 'INCOME')
        .where('je_type_filter.credit', '>', 0)
    ).whereNotExists(
      db('journal_entries as je_type_filter')
        .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
        .where('je_type_filter.transaction_id', db.raw('t.id'))
        .where('a_type_filter.type', 'EXPENSE')
        .where('je_type_filter.debit', '>', 0)
    );
  }
}

async function listTransactions(query: TransactionsQuery): Promise<TransactionsListResponse> {
  const {
    fund_id,
    account_id,
    contact_id,
    include_inactive,
    transaction_type,
    from,
    to,
    limit = 50,
    offset = 0,
  } = query;

  const includeInactive = include_inactive === true || String(include_inactive).toLowerCase() === 'true';
  if (transaction_type && !validTransactionTypes.includes(transaction_type)) {
    throw badRequest('transaction_type must be one of deposit, withdrawal, transfer');
  }
  if (from && !parseDateOnlyStrict(String(from))) {
    throw badRequest('from is not a valid date (YYYY-MM-DD)');
  }
  if (to && !parseDateOnlyStrict(String(to))) {
    throw badRequest('to is not a valid date (YYYY-MM-DD)');
  }
  if (from && to && String(from) > String(to)) {
    throw badRequest('from must be before or equal to to');
  }

  const cap = Math.min(parseInt(String(limit), 10) || 50, 200);
  const off = parseInt(String(offset), 10) || 0;
  const filters = {
    fund_id,
    account_id,
    contact_id,
    includeInactive,
    transaction_type,
    from,
    to,
  };

  const countQuery = db('transactions as t')
    .modify((q: Knex.QueryBuilder) => applyTransactionFilters(q, filters));

  const [counted] = await countQuery.count('t.id as count') as Array<{ count: string }>;
  const total = parseInt(counted?.count || '0', 10);

  const pageRows = await db('transactions as t')
    .leftJoin('users as u', 'u.id', 't.created_by')
    .modify((q: Knex.QueryBuilder) => applyTransactionFilters(q, filters))
    .select(
      't.id',
      't.date',
      't.description',
      't.reference_no',
      't.fund_id',
      't.created_at',
      't.is_voided',
      'u.name as created_by_name'
    )
    .orderBy('t.date', 'desc')
    .orderBy('t.created_at', 'desc')
    .limit(cap)
    .offset(off) as TransactionPageRow[];

  const transactionIds = pageRows.map((row) => row.id);
  const aggregateMap = new Map<number, TransactionAggregateRow>();

  if (transactionIds.length > 0) {
    const aggregateRows = await db('journal_entries as je')
      .leftJoin('accounts as a', 'a.id', 'je.account_id')
      .leftJoin('contacts as c', 'c.id', 'je.contact_id')
      .whereIn('je.transaction_id', transactionIds)
      .select([
        'je.transaction_id',
        db.raw('COALESCE(SUM(je.debit), 0) AS total_amount'),
        db.raw('COUNT(DISTINCT je.contact_id) AS contact_count'),
        db.raw('MAX(c.name) AS contact_name'),
        db.raw(`MAX(CASE WHEN a.type = 'INCOME' AND je.credit > 0 THEN 1 ELSE 0 END) AS has_income_credit`),
        db.raw(`MAX(CASE WHEN a.type = 'EXPENSE' AND je.debit > 0 THEN 1 ELSE 0 END) AS has_expense_debit`),
      ])
      .groupBy('je.transaction_id') as TransactionAggregateRow[];

    aggregateRows.forEach((row) => {
      aggregateMap.set(Number(row.transaction_id), row);
    });
  }

  const transactions: TransactionListItem[] = pageRows.map((t) => {
    const aggregate = aggregateMap.get(t.id);
    const hasIncomeCredit = Number(aggregate?.has_income_credit || 0);
    const hasExpenseDebit = Number(aggregate?.has_expense_debit || 0);
    const contactCount = Number(aggregate?.contact_count || 0);
    let transaction_type: TransactionListItem['transaction_type'] = 'transfer';
    if (hasIncomeCredit > 0) transaction_type = 'deposit';
    else if (hasExpenseDebit > 0) transaction_type = 'withdrawal';

    return {
      ...t,
      date: normalizeDateOnly(t.date),
      created_at: String(t.created_at),
      is_voided: Boolean(t.is_voided),
      total_amount: parseFloat(String(aggregate?.total_amount || 0)),
      contact_name: contactCount === 1 ? aggregate?.contact_name || null : null,
      has_multiple_contacts: contactCount > 1,
      transaction_type,
    };
  });

  return {
    transactions,
    total,
    limit: cap,
    offset: off,
  };
}

export {
  listTransactions,
};
