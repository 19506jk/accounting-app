const express     = require('express');
const Decimal     = require('decimal.js');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();
router.use(auth);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Round a value to 2 decimal places using Decimal.js.
 */
const dec = (v) => new Decimal(v ?? 0);

/**
 * Validate transaction entries — 4 layers.
 * Returns an array of error strings (empty = valid).
 */
async function validateTransaction(body) {
  const errors = [];
  const { date, description, entries, contact_id } = body;

  // ── Layer 1: Structure ───────────────────────────────────────────────────
  if (!date)              errors.push('date is required');
  if (!description?.trim()) errors.push('description is required');

  if (!Array.isArray(entries) || entries.length < 2) {
    errors.push('At least 2 journal entry lines are required');
    return errors; // can't continue without entries
  }

  for (let i = 0; i < entries.length; i++) {
    const e      = entries[i];
    const prefix = `Entry ${i + 1}:`;

    if (!e.account_id) errors.push(`${prefix} account_id is required`);
    if (!e.fund_id)    errors.push(`${prefix} fund_id is required`);

    const debit  = dec(e.debit  ?? 0);
    const credit = dec(e.credit ?? 0);

    if (debit.isNegative() || credit.isNegative()) {
      errors.push(`${prefix} amounts must be positive`);
    }

    const bothZero     = debit.isZero() && credit.isZero();
    const bothNonZero  = !debit.isZero() && !credit.isZero();

    if (bothZero)    errors.push(`${prefix} must have either a debit or credit amount`);
    if (bothNonZero) errors.push(`${prefix} cannot have both debit and credit amounts`);

    // Max 2 decimal places
    if (debit.decimalPlaces()  > 2) errors.push(`${prefix} debit cannot have more than 2 decimal places`);
    if (credit.decimalPlaces() > 2) errors.push(`${prefix} credit cannot have more than 2 decimal places`);
  }

  if (errors.length) return errors; // skip further checks if structure is broken

  // Total must be > 0
  const totalDebit = entries.reduce((sum, e) => sum.plus(dec(e.debit ?? 0)), dec(0));
  if (totalDebit.isZero()) {
    errors.push('Transaction total cannot be zero');
    return errors;
  }

  // ── Layer 2: Global balance ──────────────────────────────────────────────
  const totalCredit = entries.reduce((sum, e) => sum.plus(dec(e.credit ?? 0)), dec(0));

  if (!totalDebit.equals(totalCredit)) {
    errors.push(
      `Transaction is not balanced. Total debits $${totalDebit.toFixed(2)} ≠ total credits $${totalCredit.toFixed(2)}`
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
  // Date — max 24h in the future (timezone grace period)
  if (date) {
    const txDate  = new Date(date);
    const maxDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (isNaN(txDate.getTime())) {
      errors.push('date is not a valid date');
    } else if (txDate > maxDate) {
      errors.push('Transaction date cannot be more than 1 day in the future');
    }
  }

  // Accounts — must exist and be active
  const accountIds = [...new Set(entries.map((e) => e.account_id))];
  const accounts   = await db('accounts').whereIn('id', accountIds).where('is_active', true);
  const foundAccIds = new Set(accounts.map((a) => a.id));
  for (const id of accountIds) {
    if (!foundAccIds.has(id)) {
      errors.push(`Account #${id} does not exist or is inactive`);
    }
  }

  // Funds — must exist and be active
  const fundIds   = [...new Set(entries.map((e) => e.fund_id))];
  const funds     = await db('funds').whereIn('id', fundIds).where('is_active', true);
  const foundFundIds = new Set(funds.map((f) => f.id));
  for (const id of fundIds) {
    if (!foundFundIds.has(id)) {
      errors.push(`Fund #${id} does not exist or is inactive`);
    }
  }

  // Contact — must exist and be active (if provided)
  if (contact_id) {
    const contact = await db('contacts').where({ id: contact_id, is_active: true }).first();
    if (!contact) errors.push(`Contact #${contact_id} does not exist or is inactive`);
  }

  return errors;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/transactions
 * List transactions — header + total_amount.
 * Supports filters: fund_id, account_id, contact_id, from, to, limit, offset.
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      fund_id, account_id, contact_id,
      from, to,
      limit  = 50,
      offset = 0,
    } = req.query;

    const cap = Math.min(parseInt(limit, 10), 200);
    const off = parseInt(offset, 10) || 0;

    const baseQuery = () => db('transactions as t')
      .leftJoin('contacts as c', 'c.id', 't.contact_id')
      .leftJoin('users as u',    'u.id', 't.created_by')
      .modify((q) => {
        if (fund_id)    q.where('t.fund_id', fund_id);
        if (contact_id) q.where('t.contact_id', contact_id);
        if (from)       q.where('t.date', '>=', from);
        if (to)         q.where('t.date', '<=', to);
        if (account_id) {
          q.whereExists(
            db('journal_entries as je')
              .where('je.transaction_id', db.raw('t.id'))
              .where('je.account_id', account_id)
          );
        }
      });

    // Total count for pagination
    const [{ count }] = await baseQuery().count('t.id as count');

    // Paginated results with total_amount
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
        't.id',
        't.date',
        't.description',
        't.reference_no',
        't.contact_id',
        't.fund_id',
        't.created_at',
        'c.name as contact_name',
        'u.name as created_by_name',
        db.raw('COALESCE(je_totals.total_amount, 0) AS total_amount'),
      )
      .orderBy('t.date',       'desc')
      .orderBy('t.created_at', 'desc')
      .limit(cap)
      .offset(off);

    res.json({
      transactions: transactions.map((t) => ({
        ...t,
        total_amount: parseFloat(t.total_amount),
      })),
      total:  parseInt(count, 10),
      limit:  cap,
      offset: off,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/transactions/:id
 * Single transaction with full nested entries[].
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const transaction = await db('transactions as t')
      .leftJoin('contacts as c', 'c.id', 't.contact_id')
      .leftJoin('users as u',    'u.id', 't.created_by')
      .where('t.id', id)
      .select(
        't.id', 't.date', 't.description', 't.reference_no',
        't.contact_id', 't.fund_id', 't.created_at',
        'c.name as contact_name',
        'u.name as created_by_name',
      )
      .first();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const entries = await db('journal_entries as je')
      .join('accounts as a', 'a.id', 'je.account_id')
      .join('funds as f',    'f.id', 'je.fund_id')
      .where('je.transaction_id', id)
      .select(
        'je.id',
        'je.account_id',
        'a.code   as account_code',
        'a.name   as account_name',
        'a.type   as account_type',
        'je.fund_id',
        'f.name   as fund_name',
        'je.debit',
        'je.credit',
        'je.memo',
        'je.is_reconciled',
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
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/transactions
 * Record a new double-entry transaction.
 * All 4 validation layers run before any DB writes.
 * Atomic — all entries written in a single DB transaction.
 */
router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { date, description, reference_no, contact_id, entries } = req.body;

    // Run all 4 validation layers
    const errors = await validateTransaction(req.body);
    if (errors.length) {
      return res.status(400).json({ errors });
    }

    const result = await db.transaction(async (trx) => {
      // Insert transaction header
      const [transaction] = await trx('transactions')
        .insert({
          date,
          description:  description.trim(),
          reference_no: reference_no?.trim() || null,
          contact_id:   contact_id || null,
          // fund_id on transaction = first fund in entries (primary fund)
          fund_id:      entries[0].fund_id,
          created_by:   req.user.id,
          created_at:   trx.fn.now(),
          updated_at:   trx.fn.now(),
        })
        .returning('*');

      // Insert all journal entry lines
      const entryRows = entries.map((e) => ({
        transaction_id: transaction.id,
        account_id:     e.account_id,
        fund_id:        e.fund_id,
        debit:          dec(e.debit  ?? 0).toFixed(2),
        credit:         dec(e.credit ?? 0).toFixed(2),
        memo:           e.memo?.trim() || null,
        is_reconciled:  false,
        created_at:     trx.fn.now(),
        updated_at:     trx.fn.now(),
      }));

      const insertedEntries = await trx('journal_entries')
        .insert(entryRows)
        .returning('*');

      return { transaction, entries: insertedEntries };
    });

    res.status(201).json({
      transaction: {
        ...result.transaction,
        entries: result.entries.map((e) => ({
          ...e,
          debit:  parseFloat(e.debit),
          credit: parseFloat(e.credit),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/transactions/:id
 * Update metadata only — date, description, reference_no, contact_id.
 * Journal entries cannot be edited (delete and re-enter to correct amounts).
 */
router.put('/:id', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date, description, reference_no, contact_id } = req.body;

    const transaction = await db('transactions').where({ id }).first();
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    // Validate date if provided
    if (date) {
      const txDate  = new Date(date);
      const maxDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      if (isNaN(txDate.getTime())) {
        return res.status(400).json({ error: 'date is not a valid date' });
      }
      if (txDate > maxDate) {
        return res.status(400).json({ error: 'Transaction date cannot be more than 1 day in the future' });
      }
    }

    // Validate contact if provided
    if (contact_id !== undefined && contact_id !== null) {
      const contact = await db('contacts').where({ id: contact_id, is_active: true }).first();
      if (!contact) return res.status(400).json({ error: `Contact #${contact_id} does not exist or is inactive` });
    }

    const [updated] = await db('transactions')
      .where({ id })
      .update({
        date:         date                   || transaction.date,
        description:  description?.trim()    || transaction.description,
        reference_no: reference_no !== undefined ? reference_no?.trim() || null : transaction.reference_no,
        contact_id:   contact_id  !== undefined ? contact_id  || null : transaction.contact_id,
        updated_at:   db.fn.now(),
      })
      .returning('*');

    res.json({ transaction: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/transactions/:id
 * Hard delete — removes transaction and all journal entries.
 * Blocked if any journal entry is_reconciled = true.
 */
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const transaction = await db('transactions').where({ id }).first();
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    // Guard — check for reconciled entries
    const reconciledEntry = await db('journal_entries')
      .where({ transaction_id: id, is_reconciled: true })
      .first();

    if (reconciledEntry) {
      return res.status(409).json({
        error: 'Transaction cannot be deleted — one or more entries have been reconciled. Contact your administrator.',
      });
    }

    // journal_entries deleted via CASCADE on transaction delete
    await db('transactions').where({ id }).delete();

    res.json({ message: 'Transaction deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
