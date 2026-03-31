const express     = require('express');
const Decimal     = require('decimal.js');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();
router.use(auth);

const dec = (v) => new Decimal(v ?? 0);

// ── Validation ───────────────────────────────────────────────────────────────

async function validateTransaction(body) {
  const errors = [];
  const { date, description, entries } = body;

  // ── Layer 1: Structure ───────────────────────────────────────────────────
  if (!date)                errors.push('date is required');
  if (!description?.trim()) errors.push('description is required');

  if (!Array.isArray(entries) || entries.length < 2) {
    errors.push('At least 2 journal entry lines are required');
    return errors;
  }

  for (let i = 0; i < entries.length; i++) {
    const e      = entries[i];
    const prefix = `Entry ${i + 1}:`;

    if (!e.account_id) errors.push(`${prefix} account_id is required`);
    if (!e.fund_id)    errors.push(`${prefix} fund_id is required`);

    const debit  = dec(e.debit  ?? 0);
    const credit = dec(e.credit ?? 0);

    if (debit.isNegative() || credit.isNegative())
      errors.push(`${prefix} amounts must be positive`);
    if (debit.isZero() && credit.isZero())
      errors.push(`${prefix} must have either a debit or credit amount`);
    if (!debit.isZero() && !credit.isZero())
      errors.push(`${prefix} cannot have both debit and credit amounts`);
    if (debit.decimalPlaces()  > 2) errors.push(`${prefix} debit cannot have more than 2 decimal places`);
    if (credit.decimalPlaces() > 2) errors.push(`${prefix} credit cannot have more than 2 decimal places`);
  }

  if (errors.length) return errors;

  // Total > 0
  const totalDebit = entries.reduce((sum, e) => sum.plus(dec(e.debit ?? 0)), dec(0));
  if (totalDebit.isZero()) {
    errors.push('Transaction total cannot be zero');
    return errors;
  }

  // ── Layer 2: Global balance ──────────────────────────────────────────────
  const totalCredit = entries.reduce((sum, e) => sum.plus(dec(e.credit ?? 0)), dec(0));
  if (!totalDebit.equals(totalCredit)) {
    errors.push(
      `Transaction is not balanced. Debits $${totalDebit.toFixed(2)} ≠ credits $${totalCredit.toFixed(2)}`
    );
  }

  // ── Layer 3: Per-fund balance ────────────────────────────────────────────
  const fundTotals = {};
  for (const e of entries) {
    if (!fundTotals[e.fund_id]) fundTotals[e.fund_id] = { debit: dec(0), credit: dec(0) };
    fundTotals[e.fund_id].debit  = fundTotals[e.fund_id].debit.plus(dec(e.debit   ?? 0));
    fundTotals[e.fund_id].credit = fundTotals[e.fund_id].credit.plus(dec(e.credit ?? 0));
  }

  for (const [fundId, totals] of Object.entries(fundTotals)) {
    if (!totals.debit.equals(totals.credit)) {
      const fund = await db('funds').where({ id: fundId }).first();
      const name = fund?.name || `Fund #${fundId}`;
      errors.push(
        `"${name}" is not balanced. Debits $${totals.debit.toFixed(2)} ≠ credits $${totals.credit.toFixed(2)}`
      );
    }
  }

  if (errors.length) return errors;

  // ── Layer 4: Reference integrity ────────────────────────────────────────
  if (date) {
    const txDate  = new Date(date);
    const maxDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (isNaN(txDate.getTime())) errors.push('date is not a valid date');
    else if (txDate > maxDate)   errors.push('Transaction date cannot be more than 1 day in the future');
  }

  const accountIds   = [...new Set(entries.map((e) => e.account_id))];
  const accounts     = await db('accounts').whereIn('id', accountIds).where('is_active', true);
  const foundAccIds  = new Set(accounts.map((a) => a.id));
  for (const id of accountIds) {
    if (!foundAccIds.has(id)) errors.push(`Account #${id} does not exist or is inactive`);
  }

  const fundIds      = [...new Set(entries.map((e) => e.fund_id))];
  const funds        = await db('funds').whereIn('id', fundIds).where('is_active', true);
  const foundFundIds = new Set(funds.map((f) => f.id));
  for (const id of fundIds) {
    if (!foundFundIds.has(id)) errors.push(`Fund #${id} does not exist or is inactive`);
  }

  // Entry-level contacts
  const entryContactIds = [...new Set(entries.map((e) => e.contact_id).filter(Boolean))];
  if (entryContactIds.length > 0) {
    const entryContacts   = await db('contacts').whereIn('id', entryContactIds).where('is_active', true);
    const foundContactIds = new Set(entryContacts.map((c) => c.id));
    for (const id of entryContactIds) {
      if (!foundContactIds.has(id)) errors.push(`Contact #${id} does not exist or is inactive`);
    }
  }

  return errors;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/transactions
 * contact_id filter now joins through journal_entries.
 */
router.get('/', async (req, res, next) => {
  try {
    const { fund_id, account_id, contact_id, from, to, limit = 50, offset = 0 } = req.query;

    const cap = Math.min(parseInt(limit, 10), 200);
    const off = parseInt(offset, 10) || 0;

    const baseQuery = () => db('transactions as t')
      .leftJoin('users as u', 'u.id', 't.created_by')
      .modify((q) => {
        if (fund_id)    q.where('t.fund_id', fund_id);
        if (from)       q.where('t.date', '>=', from);
        if (to)         q.where('t.date', '<=', to);
        if (account_id) {
          q.whereExists(
            db('journal_entries as je')
              .where('je.transaction_id', db.raw('t.id'))
              .where('je.account_id', account_id)
          );
        }
        // Filter by contact via journal entries
        if (contact_id) {
          q.whereExists(
            db('journal_entries as je')
              .where('je.transaction_id', db.raw('t.id'))
              .where('je.contact_id', contact_id)
          );
        }
      });

    const [{ count }] = await baseQuery().count('t.id as count');

    const transactions = await baseQuery()
      .leftJoin(
        db('journal_entries')
          .select('transaction_id')
          .sum('debit as total_amount')
          .groupBy('transaction_id')
          .as('je_totals'),
        'je_totals.transaction_id', 't.id'
      )
      .select(
        't.id', 't.date', 't.description', 't.reference_no',
        't.fund_id', 't.created_at',
        'u.name as created_by_name',
        db.raw('COALESCE(je_totals.total_amount, 0) AS total_amount'),
      )
      .orderBy('t.date', 'desc')
      .orderBy('t.created_at', 'desc')
      .limit(cap)
      .offset(off);

    res.json({
      transactions: transactions.map((t) => ({ ...t, total_amount: parseFloat(t.total_amount) })),
      total:  parseInt(count, 10),
      limit:  cap,
      offset: off,
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/transactions/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const transaction = await db('transactions as t')
      .leftJoin('users as u', 'u.id', 't.created_by')
      .where('t.id', id)
      .select('t.id', 't.date', 't.description', 't.reference_no',
              't.fund_id', 't.created_at', 'u.name as created_by_name')
      .first();

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const entries = await db('journal_entries as je')
      .join('accounts as a',     'a.id', 'je.account_id')
      .join('funds as f',        'f.id', 'je.fund_id')
      .leftJoin('contacts as c', 'c.id', 'je.contact_id')
      .where('je.transaction_id', id)
      .select(
        'je.id', 'je.account_id',
        'a.code as account_code', 'a.name as account_name', 'a.type as account_type',
        'je.fund_id', 'f.name as fund_name',
        'je.debit', 'je.credit', 'je.memo', 'je.is_reconciled',
        'je.contact_id', 'c.name as contact_name',
      )
      .orderBy('je.id', 'asc');

    const totalAmount = entries.reduce((sum, e) => sum.plus(dec(e.debit)), dec(0));

    res.json({
      transaction: {
        ...transaction,
        total_amount: parseFloat(totalAmount.toFixed(2)),
        entries: entries.map((e) => ({
          ...e,
          debit:  parseFloat(e.debit),
          credit: parseFloat(e.credit),
        })),
      },
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/transactions
 * No contact_id on header — all contacts live on journal entry lines.
 */
router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { date, description, reference_no, entries } = req.body;

    const errors = await validateTransaction(req.body);
    if (errors.length) return res.status(400).json({ errors });

    const result = await db.transaction(async (trx) => {
      const [transaction] = await trx('transactions')
        .insert({
          date,
          description:  description.trim(),
          reference_no: reference_no?.trim() || null,
          fund_id:      entries[0].fund_id,
          created_by:   req.user.id,
          created_at:   trx.fn.now(),
          updated_at:   trx.fn.now(),
        })
        .returning('*');

      const entryRows = entries.map((e) => ({
        transaction_id: transaction.id,
        account_id:     e.account_id,
        fund_id:        e.fund_id,
        contact_id:     e.contact_id || null,
        debit:          dec(e.debit  ?? 0).toFixed(2),
        credit:         dec(e.credit ?? 0).toFixed(2),
        memo:           e.memo?.trim() || null,
        is_reconciled:  false,
        created_at:     trx.fn.now(),
        updated_at:     trx.fn.now(),
      }));

      const insertedEntries = await trx('journal_entries').insert(entryRows).returning('*');
      return { transaction, entries: insertedEntries };
    });

    res.status(201).json({
      transaction: {
        ...result.transaction,
        entries: result.entries.map((e) => ({
          ...e, debit: parseFloat(e.debit), credit: parseFloat(e.credit),
        })),
      },
    });
  } catch (err) { next(err); }
});

/**
 * PUT /api/transactions/:id
 * No contact_id on header.
 */
router.put('/:id', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date, description, reference_no } = req.body;

    const transaction = await db('transactions').where({ id }).first();
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    if (date) {
      const txDate  = new Date(date);
      const maxDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      if (isNaN(txDate.getTime())) return res.status(400).json({ error: 'date is not a valid date' });
      if (txDate > maxDate)        return res.status(400).json({ error: 'Transaction date cannot be more than 1 day in the future' });
    }

    const [updated] = await db('transactions').where({ id }).update({
      date:         date                || transaction.date,
      description:  description?.trim() || transaction.description,
      reference_no: reference_no !== undefined ? reference_no?.trim() || null : transaction.reference_no,
      updated_at:   db.fn.now(),
    }).returning('*');

    res.json({ transaction: updated });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/transactions/:id
 */
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const transaction = await db('transactions').where({ id }).first();
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const reconciledEntry = await db('journal_entries')
      .where({ transaction_id: id, is_reconciled: true }).first();

    if (reconciledEntry) {
      return res.status(409).json({
        error: 'Transaction cannot be deleted — one or more entries have been reconciled.',
      });
    }

    await db('transactions').where({ id }).delete();
    res.json({ message: 'Transaction deleted successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
