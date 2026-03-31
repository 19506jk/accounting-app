const Decimal = require('decimal.js');
const db      = require('../db');

const dec = (v) => new Decimal(v ?? 0);

// ── Shared query builder ─────────────────────────────────────────────────────

/**
 * Base journal entry query with all joins needed for reports.
 * Optionally scoped to a date range and/or fund.
 */
function baseQuery({ from, to, asOf, fundId } = {}) {
  const q = db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a',     'a.id', 'je.account_id')
    .join('funds as f',        'f.id', 'je.fund_id');

  if (from)   q.where('t.date', '>=', from);
  if (to)     q.where('t.date', '<=', to);
  if (asOf)   q.where('t.date', '<=', asOf);
  if (fundId) q.where('je.fund_id', fundId);

  return q;
}

// ── Report 1: Statement of Activities (P&L) ──────────────────────────────────

async function getPL({ from, to, fundId }) {
  const rows = await baseQuery({ from, to, fundId })
    .whereIn('a.type', ['INCOME', 'EXPENSE'])
    .select(
      'a.id',
      'a.code',
      'a.name',
      'a.type',
      db.raw('COALESCE(SUM(je.debit),  0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit'),
    )
    .groupBy('a.id', 'a.code', 'a.name', 'a.type')
    .orderBy('a.code', 'asc');

  const income   = [];
  const expenses = [];

  let totalIncome   = dec(0);
  let totalExpenses = dec(0);

  for (const row of rows) {
    const debit  = dec(row.total_debit);
    const credit = dec(row.total_credit);

    if (row.type === 'INCOME') {
      // Income: credits increase income, debits decrease it
      const net = credit.minus(debit);
      totalIncome = totalIncome.plus(net);
      income.push({
        id:     row.id,
        code:   row.code,
        name:   row.name,
        amount: parseFloat(net.toFixed(2)),
      });
    } else {
      // Expense: debits increase expense, credits decrease it
      const net = debit.minus(credit);
      totalExpenses = totalExpenses.plus(net);
      expenses.push({
        id:     row.id,
        code:   row.code,
        name:   row.name,
        amount: parseFloat(net.toFixed(2)),
      });
    }
  }

  const net = totalIncome.minus(totalExpenses);

  return {
    income,
    expenses,
    total_income:   parseFloat(totalIncome.toFixed(2)),
    total_expenses: parseFloat(totalExpenses.toFixed(2)),
    net_surplus:    parseFloat(net.toFixed(2)),
  };
}

// ── Report 2: Statement of Financial Position (Balance Sheet) ────────────────

async function getBalanceSheet({ asOf, fundId }) {
  // Balance sheet includes ALL transactions from inception up to asOf
  const rows = await baseQuery({ asOf, fundId })
    .whereIn('a.type', ['ASSET', 'LIABILITY', 'EQUITY'])
    .select(
      'a.id',
      'a.code',
      'a.name',
      'a.type',
      db.raw('COALESCE(SUM(je.debit),  0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit'),
    )
    .groupBy('a.id', 'a.code', 'a.name', 'a.type')
    .orderBy('a.code', 'asc');

  const assets      = [];
  const liabilities = [];
  const equity      = [];

  let totalAssets      = dec(0);
  let totalLiabilities = dec(0);
  let totalEquity      = dec(0);

  for (const row of rows) {
    const debit  = dec(row.total_debit);
    const credit = dec(row.total_credit);

    if (row.type === 'ASSET') {
      // Assets: debits increase, credits decrease
      const balance = debit.minus(credit);
      totalAssets = totalAssets.plus(balance);
      assets.push({
        id:      row.id,
        code:    row.code,
        name:    row.name,
        balance: parseFloat(balance.toFixed(2)),
      });
    } else if (row.type === 'LIABILITY') {
      // Liabilities: credits increase, debits decrease
      const balance = credit.minus(debit);
      totalLiabilities = totalLiabilities.plus(balance);
      liabilities.push({
        id:      row.id,
        code:    row.code,
        name:    row.name,
        balance: parseFloat(balance.toFixed(2)),
      });
    } else {
      // Equity: credits increase, debits decrease
      const balance = credit.minus(debit);
      totalEquity = totalEquity.plus(balance);
      equity.push({
        id:      row.id,
        code:    row.code,
        name:    row.name,
        balance: parseFloat(balance.toFixed(2)),
      });
    }
  }

  const totalLiabilitiesAndEquity = totalLiabilities.plus(totalEquity);
  const isBalanced = totalAssets.equals(totalLiabilitiesAndEquity);

  return {
    assets,
    liabilities,
    equity,
    total_assets:                parseFloat(totalAssets.toFixed(2)),
    total_liabilities:           parseFloat(totalLiabilities.toFixed(2)),
    total_equity:                parseFloat(totalEquity.toFixed(2)),
    total_liabilities_and_equity: parseFloat(totalLiabilitiesAndEquity.toFixed(2)),
    is_balanced:                 isBalanced,
  };
}

// ── Report 3: General Ledger ──────────────────────────────────────────────────

async function getLedger({ from, to, fundId, accountId }) {
  // Fetch accounts that have activity (or the specific account requested)
  const accountQuery = db('accounts as a')
    .where('a.is_active', true)
    .orderBy('a.code', 'asc');

  if (accountId) {
    accountQuery.where('a.id', accountId);
  }

  const accounts = await accountQuery.select('a.id', 'a.code', 'a.name', 'a.type');

  const ledger = [];

  for (const account of accounts) {
    // All entries for this account in the date range
    const entries = await baseQuery({ from, to, fundId })
      .where('je.account_id', account.id)
      .select(
        't.date',
        't.description',
        't.reference_no',
        'f.name  as fund_name',
        'je.debit',
        'je.credit',
        'je.memo',
      )
      .orderBy('t.date', 'asc')
      .orderBy('je.id',  'asc');

    if (entries.length === 0 && !accountId) continue; // skip inactive accounts in full ledger

    // Calculate opening balance (all entries BEFORE the from date)
    let openingBalance = dec(0);
    if (from) {
      const prior = await db('journal_entries as je')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .where('je.account_id', account.id)
        .where('t.date', '<', from)
        .modify((q) => { if (fundId) q.where('je.fund_id', fundId); })
        .select(
          db.raw('COALESCE(SUM(je.debit),  0) AS total_debit'),
          db.raw('COALESCE(SUM(je.credit), 0) AS total_credit'),
        )
        .first();

      // Opening balance depends on account type
      if (['ASSET', 'EXPENSE'].includes(account.type)) {
        openingBalance = dec(prior.total_debit).minus(dec(prior.total_credit));
      } else {
        openingBalance = dec(prior.total_credit).minus(dec(prior.total_debit));
      }
    }

    // Build rows with running balance
    let runningBalance = openingBalance;
    const rows = entries.map((e) => {
      const debit  = dec(e.debit);
      const credit = dec(e.credit);

      if (['ASSET', 'EXPENSE'].includes(account.type)) {
        runningBalance = runningBalance.plus(debit).minus(credit);
      } else {
        runningBalance = runningBalance.plus(credit).minus(debit);
      }

      return {
        date:          e.date,
        description:   e.description,
        reference_no:  e.reference_no,
        fund_name:     e.fund_name,
        debit:         parseFloat(dec(e.debit).toFixed(2)),
        credit:        parseFloat(dec(e.credit).toFixed(2)),
        memo:          e.memo,
        balance:       parseFloat(runningBalance.toFixed(2)),
      };
    });

    ledger.push({
      account: {
        id:   account.id,
        code: account.code,
        name: account.name,
        type: account.type,
      },
      opening_balance: parseFloat(openingBalance.toFixed(2)),
      closing_balance: parseFloat(runningBalance.toFixed(2)),
      rows,
    });
  }

  return { ledger };
}

// ── Report 4: Trial Balance ───────────────────────────────────────────────────

async function getTrialBalance({ from, to, fundId }) {
  const rows = await baseQuery({ from, to, fundId })
    .select(
      'a.id',
      'a.code',
      'a.name',
      'a.type',
      db.raw('COALESCE(SUM(je.debit),  0) AS total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credit'),
    )
    .groupBy('a.id', 'a.code', 'a.name', 'a.type')
    .orderBy('a.code', 'asc');

  let grandDebit  = dec(0);
  let grandCredit = dec(0);

  const accounts = rows.map((row) => {
    const debit  = dec(row.total_debit);
    const credit = dec(row.total_credit);
    grandDebit   = grandDebit.plus(debit);
    grandCredit  = grandCredit.plus(credit);

    return {
      id:           row.id,
      code:         row.code,
      name:         row.name,
      type:         row.type,
      total_debit:  parseFloat(debit.toFixed(2)),
      total_credit: parseFloat(credit.toFixed(2)),
    };
  });

  const isBalanced = grandDebit.equals(grandCredit);

  return {
    accounts,
    grand_total_debit:  parseFloat(grandDebit.toFixed(2)),
    grand_total_credit: parseFloat(grandCredit.toFixed(2)),
    is_balanced:        isBalanced,
  };
}


// ── Report 5: Income by Donor Summary ────────────────────────────────────────

/**
 * Returns one row per donor with their aggregated donation total
 * for the period. Anonymous transactions (no contact_id) are grouped
 * at the end.
 */
async function getDonorSummary({ from, to, fundId }) {
  // Named donors
  const rows = await db('transactions as t')
    .join('journal_entries as je', 'je.transaction_id', 't.id')
    .join('accounts as a',         'a.id',              'je.account_id')
    .join('contacts as c',         'c.id',              'je.contact_id')
    .where('a.type',    'INCOME')
    .where('je.credit', '>', 0)
    .whereNotNull('je.contact_id')
    .modify((q) => {
      if (from)   q.where('t.date', '>=', from);
      if (to)     q.where('t.date', '<=', to);
      if (fundId) q.where('je.fund_id', fundId);
    })
    .select(
      'c.id            as contact_id',
      'c.name          as contact_name',
      'c.type          as contact_type',
      'c.contact_class as contact_class',
      db.raw('COALESCE(SUM(je.credit), 0) AS total'),
      db.raw('COUNT(DISTINCT t.id)        AS transaction_count'),
    )
    .groupBy('c.id', 'c.name', 'c.type', 'c.contact_class')
    .orderBy('total', 'desc');

  // Anonymous total
  const anonRow = await db('transactions as t')
    .join('journal_entries as je', 'je.transaction_id', 't.id')
    .join('accounts as a',         'a.id',              'je.account_id')
    .where('a.type',    'INCOME')
    .where('je.credit', '>', 0)
    .whereNull('je.contact_id')
    .modify((q) => {
      if (from)   q.where('t.date', '>=', from);
      if (to)     q.where('t.date', '<=', to);
      if (fundId) q.where('je.fund_id', fundId);
    })
    .select(
      db.raw('COALESCE(SUM(je.credit), 0) AS total'),
      db.raw('COUNT(DISTINCT t.id)        AS transaction_count'),
    )
    .first();

  const donors = rows.map((r) => ({
    contact_id:        r.contact_id,
    contact_name:      r.contact_name,
    contact_type:      r.contact_type,
    contact_class:     r.contact_class,
    total:             parseFloat(dec(r.total).toFixed(2)),
    transaction_count: parseInt(r.transaction_count, 10),
  }));

  const grandTotal = donors.reduce((sum, d) => sum.plus(dec(d.total)), dec(0));
  const anonTotal  = dec(anonRow?.total ?? 0);

  return {
    donors,
    anonymous: {
      total:             parseFloat(anonTotal.toFixed(2)),
      transaction_count: parseInt(anonRow?.transaction_count ?? 0, 10),
    },
    grand_total: parseFloat(grandTotal.plus(anonTotal).toFixed(2)),
    donor_count: donors.length,
  };
}

// ── Report 6: Income by Donor Detail ─────────────────────────────────────────

/**
 * Returns every individual donation transaction per donor
 * for the period, grouped by donor.
 * Anonymous transactions appear as a flat list at the end.
 * Optionally filter to a single contact with ?contact_id=
 */
async function getDonorDetail({ from, to, fundId, contactId }) {
  const donationQuery = () => db('transactions as t')
    .join('journal_entries as je', 'je.transaction_id', 't.id')
    .join('accounts as a',         'a.id',              'je.account_id')
    .join('funds as f',            'f.id',              'je.fund_id')
    .where('a.type',    'INCOME')
    .where('je.credit', '>', 0)
    .modify((q) => {
      if (from)   q.where('t.date', '>=', from);
      if (to)     q.where('t.date', '<=', to);
      if (fundId) q.where('je.fund_id', fundId);
    })
    .select(
      't.id          as transaction_id',
      't.date',
      't.description',
      't.reference_no',
      'a.code        as account_code',
      'a.name        as account_name',
      'f.name        as fund_name',
      'je.credit     as amount',
      'je.memo',
    )
    .orderBy('t.date', 'asc');

  // Single contact filter
  if (contactId) {
    const contact = await db('contacts').where({ id: contactId }).first();
    if (!contact) return { donors: [], anonymous: null, grand_total: 0 };

    const transactions = await donationQuery().where('je.contact_id', contactId);
    const total = transactions.reduce((sum, tx) => sum.plus(dec(tx.amount)), dec(0));

    return {
      donors: [{
        contact_id:    contact.id,
        contact_name:  contact.name,
        contact_class: contact.contact_class,
        total:         parseFloat(total.toFixed(2)),
        transactions:  transactions.map((tx) => ({
          ...tx, amount: parseFloat(dec(tx.amount).toFixed(2)),
        })),
      }],
      anonymous:   null,
      grand_total: parseFloat(total.toFixed(2)),
    };
  }

  // All donors with donations in this period
  const contactIds = await donationQuery()
    .whereNotNull('je.contact_id')
    .distinct('je.contact_id as id');

  const donors   = [];
  let grandTotal = dec(0);

  for (const { id } of contactIds) {
    const contact      = await db('contacts').where({ id }).first();
    const transactions = await donationQuery().where('je.contact_id', id);
    const total        = transactions.reduce((sum, tx) => sum.plus(dec(tx.amount)), dec(0));
    grandTotal         = grandTotal.plus(total);

    donors.push({
      contact_id:    contact.id,
      contact_name:  contact.name,
      contact_class: contact.contact_class,
      total:         parseFloat(total.toFixed(2)),
      transactions:  transactions.map((tx) => ({
        ...tx, amount: parseFloat(dec(tx.amount).toFixed(2)),
      })),
    });
  }

  // Sort by total descending
  donors.sort((a, b) => b.total - a.total);

  // Anonymous transactions
  const anonTransactions = await donationQuery().whereNull('je.contact_id');
  const anonTotal        = anonTransactions.reduce((sum, tx) => sum.plus(dec(tx.amount)), dec(0));
  grandTotal             = grandTotal.plus(anonTotal);

  return {
    donors,
    anonymous: {
      total:        parseFloat(anonTotal.toFixed(2)),
      transactions: anonTransactions.map((tx) => ({
        ...tx, amount: parseFloat(dec(tx.amount).toFixed(2)),
      })),
    },
    grand_total: parseFloat(grandTotal.toFixed(2)),
  };
}

module.exports = {
  getPL,
  getBalanceSheet,
  getLedger,
  getTrialBalance,
  getDonorSummary,
  getDonorDetail,
};
