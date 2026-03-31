const express     = require('express');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();

// All fund routes require authentication
router.use(auth);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the next available equity account code in the range 3000–3899.
 * Throws if the range is exhausted.
 */
async function nextEquityCode(trx) {
  const rows = await (trx || db)('accounts')
    .where('type', 'EQUITY')
    .whereBetween('code', ['3000', '3899'])
    .select('code')
    .orderBy('code', 'desc');

  if (rows.length === 0) return '3000';

  const highest = parseInt(rows[0].code, 10);
  const next    = highest + 1;

  if (next > 3899) {
    throw Object.assign(
      new Error('Maximum auto-generated equity account range (3000–3899) exhausted. Please manually assign a code.'),
      { status: 409 }
    );
  }

  return String(next);
}

/**
 * Calculate the current balance of a fund's net asset account.
 * Balance = SUM(credit) - SUM(debit) on EQUITY accounts for this fund.
 * Excludes voided transactions.
 */
async function fundBalance(fundId) {
  const result = await db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a',     'a.id', 'je.account_id')
    .where('je.fund_id', fundId)
    .where('a.type',     'EQUITY')
    .where('t.is_voided', false)  // Exclude voided transactions
    .select(
      db.raw('COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0) AS balance')
    )
    .first();

  return parseFloat(result?.balance || 0);
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/funds
 * List all funds with their linked net asset account.
 */
router.get('/', async (req, res, next) => {
  try {
    const funds = await db('funds as f')
      .leftJoin('accounts as a', 'a.id', 'f.net_asset_account_id')
      .select(
        'f.id',
        'f.name',
        'f.description',
        'f.is_active',
        'f.created_at',
        'f.net_asset_account_id',
        'a.code  as net_asset_code',
        'a.name  as net_asset_name',
      )
      .orderBy('f.is_active', 'desc')
      .orderBy('f.name',      'asc');

    res.json({ funds });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/funds/:id
 * Single fund with net asset account details.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const fund = await db('funds as f')
      .leftJoin('accounts as a', 'a.id', 'f.net_asset_account_id')
      .where('f.id', req.params.id)
      .select(
        'f.id',
        'f.name',
        'f.description',
        'f.is_active',
        'f.created_at',
        'f.net_asset_account_id',
        'a.code as net_asset_code',
        'a.name as net_asset_name',
      )
      .first();

    if (!fund) return res.status(404).json({ error: 'Fund not found' });

    res.json({ fund });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/funds
 * Create a fund + auto-create its Net Asset equity account.
 * Wrapped in a DB transaction — either both succeed or both roll back.
 *
 * Body: { name, description? }
 */
router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Fund name is required' });
    }

    // Check for duplicate fund name
    const existing = await db('funds').whereRaw('LOWER(name) = LOWER(?)', [name]).first();
    if (existing) {
      return res.status(409).json({ error: 'A fund with that name already exists' });
    }

    const result = await db.transaction(async (trx) => {
      // 1. Find next available equity code
      const code = await nextEquityCode(trx);

      // 2. Create the Net Asset equity account
      const [equityAccount] = await trx('accounts')
        .insert({
          code,
          name:       `${name.trim()} - Net Assets`,
          type:       'EQUITY',
          is_active:  true,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning('*');

      // 3. Create the fund linked to the equity account
      const [fund] = await trx('funds')
        .insert({
          name:                 name.trim(),
          description:          description?.trim() || null,
          net_asset_account_id: equityAccount.id,
          is_active:            true,
          created_at:           trx.fn.now(),
          updated_at:           trx.fn.now(),
        })
        .returning('*');

      return { fund, equityAccount };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/funds/:id
 * Update fund name or description.
 * Renames the linked Net Asset account to match the new fund name.
 *
 * Body: { name?, description? }
 */
router.put('/:id', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const { id }                = req.params;

    const fund = await db('funds').where({ id }).first();
    if (!fund) return res.status(404).json({ error: 'Fund not found' });

    // Check for duplicate name (excluding self)
    if (name) {
      const duplicate = await db('funds')
        .whereRaw('LOWER(name) = LOWER(?)', [name])
        .whereNot({ id })
        .first();
      if (duplicate) {
        return res.status(409).json({ error: 'A fund with that name already exists' });
      }
    }

    await db.transaction(async (trx) => {
      const newName = name?.trim() || fund.name;

      // Update the fund
      await trx('funds')
        .where({ id })
        .update({
          name:        newName,
          description: description !== undefined ? description?.trim() || null : fund.description,
          updated_at:  trx.fn.now(),
        });

      // Keep the Net Asset account name in sync
      if (name && fund.net_asset_account_id) {
        await trx('accounts')
          .where({ id: fund.net_asset_account_id })
          .update({
            name:       `${newName} - Net Assets`,
            updated_at: trx.fn.now(),
          });
      }
    });

    const updated = await db('funds').where({ id }).first();
    res.json({ fund: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/funds/:id
 * Soft delete — sets is_active = false.
 *
 * Guards:
 *  1. Fund has transaction history → 409
 *  2. Fund net asset balance ≠ 0  → 409
 */
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const fund = await db('funds').where({ id }).first();
    if (!fund) return res.status(404).json({ error: 'Fund not found' });

    // Guard 1 — transaction history
    const { count } = await db('transactions')
      .where({ fund_id: id })
      .count('id as count')
      .first();

    if (parseInt(count, 10) > 0) {
      return res.status(409).json({
        error: 'Fund has transaction history and cannot be deactivated. Set it to inactive manually if needed.',
      });
    }

    // Guard 2 — non-zero balance
    const balance = await fundBalance(id);
    if (balance !== 0) {
      return res.status(409).json({
        error: `Fund still carries a balance of $${balance.toFixed(2)}. Zero it out before deactivating.`,
      });
    }

    await db('funds')
      .where({ id })
      .update({ is_active: false, updated_at: db.fn.now() });

    res.json({ message: 'Fund deactivated successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
