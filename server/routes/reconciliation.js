const express     = require('express');
const Decimal     = require('decimal.js');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();
router.use(auth);

// ── Helpers ──────────────────────────────────────────────────────────────────

const dec = (v) => new Decimal(v ?? 0);

/**
 * Calculate cleared balance for a reconciliation.
 * Formula depends on account type:
 *   ASSET:     opening + SUM(cleared debits) - SUM(cleared credits)
 *   LIABILITY: opening - SUM(cleared debits) + SUM(cleared credits)
 */
async function calcBalance(reconciliationId, openingBalance, accountType) {
  const result = await db('rec_items as ri')
    .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
    .where('ri.reconciliation_id', reconciliationId)
    .where('ri.is_cleared', true)
    .select(
      db.raw('COALESCE(SUM(je.debit),  0) AS total_debits'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credits'),
    )
    .first();

  const debits  = dec(result.total_debits);
  const credits = dec(result.total_credits);
  const opening = dec(openingBalance);

  if (accountType === 'ASSET') {
    return opening.plus(debits).minus(credits);
  }
  // LIABILITY
  return opening.minus(debits).plus(credits);
}

/**
 * Build the summary counts for a reconciliation.
 */
async function calcSummary(reconciliationId) {
  const stats = await db('rec_items as ri')
    .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
    .where('ri.reconciliation_id', reconciliationId)
    .select(
      db.raw('COUNT(*) as total_items'),
      db.raw('COUNT(*) FILTER (WHERE ri.is_cleared = true) as cleared_items'),
      db.raw('COALESCE(SUM(je.debit)  FILTER (WHERE ri.is_cleared = true), 0) as cleared_debits'),
      db.raw('COALESCE(SUM(je.credit) FILTER (WHERE ri.is_cleared = true), 0) as cleared_credits')
    )
    .first();

  return {
    total_items:     parseInt(stats.total_items, 10),
    cleared_items:   parseInt(stats.cleared_items, 10),
    uncleared_items: parseInt(stats.total_items) - parseInt(stats.cleared_items),
    cleared_debits:  parseFloat(dec(stats.cleared_debits).toFixed(2)),
    cleared_credits: parseFloat(dec(stats.cleared_credits).toFixed(2)),
  };
}

/**
 * Load unreconciled journal entries for an account up to a date
 * and insert them as rec_items (skipping any already present).
 */
async function loadItems(trx, reconciliationId, accountId, statementDate) {
const entries = await (trx || db)('journal_entries as je')
  .join('transactions as t', 't.id', 'je.transaction_id')
  .leftJoin('rec_items as ri', function() {
    this.on('ri.journal_entry_id', '=', 'je.id')
        .andOn('ri.reconciliation_id', '=', db.raw('?', [reconciliationId]));
  })
  .where('je.account_id', accountId)
  .where('je.is_reconciled', false)
  .where('t.date', '<=', statementDate)
  .whereNull('ri.id') // Only entries not already in this reconciliation
  .select('je.id');

  if (entries.length === 0) return 0;

  await (trx || db)('rec_items').insert(
    entries.map((e) => ({
      reconciliation_id: reconciliationId,
      journal_entry_id:  e.id,
      is_cleared:        false,
      created_at:        (trx || db).fn.now(),
      updated_at:        (trx || db).fn.now(),
    }))
  );

  return entries.length;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/reconciliations
 * List all reconciliations with status summary.
 */
router.get('/', async (req, res, next) => {
  try {
    const reconciliations = await db('reconciliations as r')
      .join('accounts as a', 'a.id', 'r.account_id')
      .leftJoin('users as u', 'u.id', 'r.created_by')
      .select(
        'r.id',
        'r.account_id',
        'a.name  as account_name',
        'a.code  as account_code',
        'r.statement_date',
        'r.statement_balance',
        'r.opening_balance',
        'r.is_closed',
        'r.created_at',
        'u.name  as created_by_name',
      )
      .orderBy('r.statement_date', 'desc');

    res.json({ reconciliations });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reconciliations/:id
 * Single reconciliation with items and live balance calculation.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const recon = await db('reconciliations as r')
      .join('accounts as a', 'a.id', 'r.account_id')
      .where('r.id', id)
      .select(
        'r.id',
        'r.account_id',
        'a.name  as account_name',
        'a.code  as account_code',
        'a.type  as account_type',
        'r.statement_date',
        'r.statement_balance',
        'r.opening_balance',
        'r.is_closed',
        'r.created_at',
      )
      .first();

    if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });

    // Load items with transaction details
    const items = await db('rec_items as ri')
      .join('journal_entries as je', 'je.id',  'ri.journal_entry_id')
      .join('transactions as t',     't.id',   'je.transaction_id')
      .join('funds as f',            'f.id',   'je.fund_id')
      .where('ri.reconciliation_id', id)
      .select(
        'ri.id',
        'ri.journal_entry_id',
        'ri.is_cleared',
        't.date',
        't.description',
        't.reference_no',
        'f.name  as fund_name',
        'je.debit',
        'je.credit',
      )
      .orderBy('t.date', 'asc');

    // Live balance
    const clearedBalance = await calcBalance(id, recon.opening_balance, recon.account_type);
    const difference     = dec(recon.statement_balance).minus(clearedBalance);
    const summary        = await calcSummary(id);

    res.json({
      reconciliation: {
        ...recon,
        statement_balance: parseFloat(recon.statement_balance),
        opening_balance:   parseFloat(recon.opening_balance),
        cleared_balance:   parseFloat(clearedBalance.toFixed(2)),
        difference:        parseFloat(difference.toFixed(2)),
        status:            difference.isZero() ? 'BALANCED' : 'UNBALANCED',
        summary,
        items: items.map((item) => ({
          ...item,
          debit:  parseFloat(item.debit),
          credit: parseFloat(item.credit),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reconciliations
 * Start a new reconciliation for an account.
 *
 * Body: { account_id, statement_date, statement_balance, opening_balance }
 *
 * Guards:
 *  - Account must be ASSET or LIABILITY
 *  - No open reconciliation for this account
 *  - Opening balance must match last closed statement_balance (if any)
 */
router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { account_id, statement_date, statement_balance, opening_balance } = req.body;

    if (!account_id || !statement_date || statement_balance === undefined) {
      return res.status(400).json({
        error: 'account_id, statement_date, and statement_balance are required',
      });
    }

    // Account must exist and be ASSET or LIABILITY
    const account = await db('accounts').where({ id: account_id, is_active: true }).first();
    if (!account) {
      return res.status(404).json({ error: 'Account not found or inactive' });
    }
    if (!['ASSET', 'LIABILITY'].includes(account.type)) {
      return res.status(400).json({
        error: 'Only ASSET or LIABILITY accounts can be reconciled',
      });
    }

    // Guard — no open reconciliation for this account
    const openRecon = await db('reconciliations')
      .where({ account_id, is_closed: false })
      .first();
    if (openRecon) {
      return res.status(409).json({
        error: `Account already has an open reconciliation (#${openRecon.id}). Close it before starting a new one.`,
      });
    }

    // Opening balance validation
    const lastClosed = await db('reconciliations')
      .where({ account_id, is_closed: true })
      .orderBy('statement_date', 'desc')
      .first();

    if (lastClosed && new Date(statement_date) <= new Date(lastClosed.statement_date)) {
      return res.status(400).json({
        error: `Statement date must be after the last closed reconciliation (${lastClosed.statement_date})`
      });
    }

    if (lastClosed) {
      const expectedOpening = dec(lastClosed.statement_balance);
      const providedOpening = dec(opening_balance ?? 0);
      if (!expectedOpening.equals(providedOpening)) {
        return res.status(400).json({
          error: `Opening balance must equal the previous closing balance of $${expectedOpening.toFixed(2)}`,
          expected: parseFloat(expectedOpening.toFixed(2)),
        });
      }
    }

    const result = await db.transaction(async (trx) => {
      const [recon] = await trx('reconciliations')
        .insert({
          account_id,
          statement_date,
          statement_balance: dec(statement_balance).toFixed(2),
          opening_balance:   dec(opening_balance ?? 0).toFixed(2),
          is_closed:         false,
          created_by:        req.user.id,
          created_at:        trx.fn.now(),
          updated_at:        trx.fn.now(),
        })
        .returning('*');

      const loaded = await loadItems(trx, recon.id, account_id, statement_date);
      return { recon, loaded };
    });

    res.status(201).json({
      reconciliation: result.recon,
      items_loaded:   result.loaded,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/reconciliations/:id
 * Update statement_balance or statement_date.
 * If statement_date changes — delta sync rec_items.
 * Blocked if reconciliation is closed.
 */
router.put('/:id', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { statement_balance, statement_date } = req.body;

    const recon = await db('reconciliations').where({ id }).first();
    if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
    if (recon.is_closed) {
      return res.status(409).json({ error: 'Cannot edit a closed reconciliation' });
    }

    const newDate    = statement_date    || recon.statement_date;
    const newBalance = statement_balance !== undefined
      ? dec(statement_balance).toFixed(2)
      : recon.statement_balance;

    await db.transaction(async (trx) => {
      // Update the reconciliation header
      await trx('reconciliations').where({ id }).update({
        statement_balance: newBalance,
        statement_date:    newDate,
        updated_at:        trx.fn.now(),
      });

      // Delta sync only needed if statement_date changed
      if (statement_date && statement_date !== recon.statement_date) {
        // Step 1 — remove items whose transaction date is now beyond new date
        const futureEntryIds = await trx('rec_items as ri')
          .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
          .join('transactions as t',     't.id',  'je.transaction_id')
          .where('ri.reconciliation_id', id)
          .where('t.date', '>', newDate)
          .pluck('ri.id');

        if (futureEntryIds.length > 0) {
          await trx('rec_items').whereIn('id', futureEntryIds).delete();
        }

        // Step 2 — add new items within the extended date range
        // (loadItems skips existing ones — preserves cleared progress)
        await loadItems(trx, id, recon.account_id, newDate);
      }
    });

    const updated = await db('reconciliations').where({ id }).first();
    res.json({ reconciliation: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reconciliations/:id/items/:itemId/clear
 * Toggle a rec_item between cleared and uncleared.
 * Blocked if reconciliation is closed.
 */
router.post('/:id/items/:itemId/clear', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { id, itemId } = req.params;

    const recon = await db('reconciliations').where({ id }).first();
    if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
    if (recon.is_closed) {
      return res.status(409).json({ error: 'Cannot modify a closed reconciliation' });
    }

    const item = await db('rec_items')
      .where({ id: itemId, reconciliation_id: id })
      .first();
    if (!item) return res.status(404).json({ error: 'Item not found in this reconciliation' });

    const [updated] = await db('rec_items')
      .where({ id: itemId })
      .update({
        is_cleared: !item.is_cleared,
        updated_at: db.fn.now(),
      })
      .returning('*');

    // Return updated balance so the frontend can update live
    const account        = await db('accounts').where({ id: recon.account_id }).first();
    const clearedBalance = await calcBalance(id, recon.opening_balance, account.type);
    const difference     = dec(recon.statement_balance).minus(clearedBalance);

    res.json({
      item:            updated,
      cleared_balance: parseFloat(clearedBalance.toFixed(2)),
      difference:      parseFloat(difference.toFixed(2)),
      status:          difference.isZero() ? 'BALANCED' : 'UNBALANCED',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reconciliations/:id/close
 * Close a reconciliation when difference === 0.
 * Atomic — locks reconciliation and marks all cleared entries as reconciled.
 */
router.post('/:id/close', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const recon = await db('reconciliations').where({ id }).first();
    if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
    if (recon.is_closed) {
      return res.status(409).json({ error: 'Reconciliation is already closed' });
    }

    const account        = await db('accounts').where({ id: recon.account_id }).first();
    const clearedBalance = await calcBalance(id, recon.opening_balance, account.type);
    const difference     = dec(recon.statement_balance).minus(clearedBalance);

    if (!difference.isZero()) {
      return res.status(400).json({
        error:      `Cannot close — reconciliation is not balanced. Difference: $${difference.toFixed(2)}`,
        difference: parseFloat(difference.toFixed(2)),
      });
    }

    await db.transaction(async (trx) => {
      // Lock the reconciliation
      await trx('reconciliations').where({ id }).update({
        is_closed:  true,
        updated_at: trx.fn.now(),
      });

      // Mark all cleared journal entries as reconciled
      const clearedEntryIds = await trx('rec_items')
        .where({ reconciliation_id: id, is_cleared: true })
        .pluck('journal_entry_id');

      if (clearedEntryIds.length > 0) {
        await trx('journal_entries')
          .whereIn('id', clearedEntryIds)
          .update({
            is_reconciled: true,
            updated_at:    trx.fn.now(),
          });
      }
    });

    const summary = await calcSummary(id);

    res.json({
      message: 'Reconciliation closed successfully',
      summary,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/reconciliations/:id
 * Delete an open reconciliation and its items.
 * Blocked if closed.
 */
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const recon = await db('reconciliations').where({ id }).first();
    if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
    if (recon.is_closed) {
      return res.status(409).json({
        error: 'Cannot delete a closed reconciliation — it is part of the audit trail',
      });
    }

    // rec_items deleted via CASCADE
    await db('reconciliations').where({ id }).delete();

    res.json({ message: 'Reconciliation deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
