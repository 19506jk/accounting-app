const express     = require('express');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();

// All account routes require authentication
router.use(auth);

// Type sort order for Chart of Accounts display
const TYPE_ORDER = { ASSET: 1, LIABILITY: 2, EQUITY: 3, INCOME: 4, EXPENSE: 5 };

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/accounts
 * List all accounts sorted by type → code.
 * Supports ?type= filter.
 * Includes is_deletable flag for UI.
 */
router.get('/', async (req, res, next) => {
  try {
    const { type } = req.query;

    const query = db('accounts as a')
      .where('a.is_active', true)
      .leftJoin(
        // Find accounts that are net asset accounts for active funds
        db('funds').where('is_active', true).select('net_asset_account_id').as('af'),
        'af.net_asset_account_id', 'a.id'
      )
      .select(
        'a.id',
        'a.code',
        'a.name',
        'a.type',
        'a.parent_id',
        'a.is_active',
        db.raw('(SELECT COUNT(*) FROM journal_entries je WHERE je.account_id = a.id) AS journal_entry_count'),
        db.raw(`
          CASE
            WHEN (SELECT COUNT(*) FROM journal_entries je WHERE je.account_id = a.id) > 0 THEN false
            WHEN af.net_asset_account_id IS NOT NULL THEN false
            ELSE true
          END AS is_deletable
        `)
      );

    if (type) {
      const validTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
      if (!validTypes.includes(type.toUpperCase())) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
      }
      query.where('a.type', type.toUpperCase());
    }

    const accounts = await query.orderBy('a.code', 'asc');

    // Sort by type order, then by code within each type
    accounts.sort((a, b) => {
      const typeDiff = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
      if (typeDiff !== 0) return typeDiff;
      return a.code.localeCompare(b.code);
    });

    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/accounts/:id
 * Single account.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const account = await db('accounts').where({ id: req.params.id }).first();
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ account });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/accounts
 * Create a new account.
 *
 * Body: { code, name, type, parent_id? }
 */
router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { code, name, type, parent_id } = req.body;

    // Validate required fields
    if (!code?.trim() || !name?.trim() || !type) {
      return res.status(400).json({ error: 'code, name, and type are required' });
    }

    const validTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
    if (!validTypes.includes(type.toUpperCase())) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    // Check for duplicate code
    const existing = await db('accounts').where({ code: code.trim() }).first();
    if (existing) {
      return res.status(409).json({ error: `Account code ${code} already exists` });
    }

    // Validate parent account exists if provided
    if (parent_id) {
      const parent = await db('accounts').where({ id: parent_id }).first();
      if (!parent) return res.status(400).json({ error: 'Parent account not found' });
      if (parent.type !== type.toUpperCase()) {
        return res.status(400).json({ error: 'Sub-account must be the same type as its parent' });
      }
    }

    const [account] = await db('accounts')
      .insert({
        code:       code.trim(),
        name:       name.trim(),
        type:       type.toUpperCase(),
        parent_id:  parent_id || null,
        is_active:  true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*');

    res.status(201).json({ account });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/accounts/:id
 * Update account name or code.
 * Blocks type changes if the account has journal entries.
 *
 * Body: { code?, name?, type?, parent_id? }
 */
router.put('/:id', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { id }                       = req.params;
    const { code, name, type, parent_id } = req.body;

    const account = await db('accounts').where({ id }).first();
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Block type change if account has journal entries
    if (type && type.toUpperCase() !== account.type) {
      const { count } = await db('journal_entries')
        .where({ account_id: id })
        .count('id as count')
        .first();

      if (parseInt(count, 10) > 0) {
        return res.status(409).json({
          error: 'Cannot change account type — this account has transaction history.',
        });
      }
    }

    // Check for duplicate code (excluding self)
    if (code && code.trim() !== account.code) {
      const duplicate = await db('accounts')
        .where({ code: code.trim() })
        .whereNot({ id })
        .first();
      if (duplicate) {
        return res.status(409).json({ error: `Account code ${code} already exists` });
      }
    }

    const [updated] = await db('accounts')
      .where({ id })
      .update({
        code:       code?.trim()         || account.code,
        name:       name?.trim()         || account.name,
        type:       type?.toUpperCase()  || account.type,
        parent_id:  parent_id !== undefined ? parent_id || null : account.parent_id,
        updated_at: db.fn.now(),
      })
      .returning('*');

    res.json({ account: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/accounts/:id
 * Soft delete — sets is_active = false.
 *
 * Guards:
 *  1. Account has journal entries → 409
 *  2. Account is a net asset account for an active fund → 409
 */
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const account = await db('accounts').where({ id }).first();
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Guard 1 — journal entry history
    const { count: jeCount } = await db('journal_entries')
      .where({ account_id: id })
      .count('id as count')
      .first();

    if (parseInt(jeCount, 10) > 0) {
      return res.status(409).json({
        error: 'Cannot delete account — it has transaction history. Deactivate it instead.',
      });
    }

    // Guard 2 — net asset account for an active fund
    const linkedFund = await db('funds')
      .where({ net_asset_account_id: id, is_active: true })
      .first();

    if (linkedFund) {
      return res.status(409).json({
        error: `Cannot delete — this is the Net Asset account for the active fund "${linkedFund.name}".`,
      });
    }

    await db('accounts')
      .where({ id })
      .update({ is_active: false, updated_at: db.fn.now() });

    res.json({ message: 'Account deactivated successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
