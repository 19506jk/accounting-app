/**
 * Tax Rates Routes — /api/tax-rates
 *
 * Endpoints:
 *   GET  /api/tax-rates          — list all tax rates (active only by default)
 *   PUT  /api/tax-rates/:id      — update a tax rate's rate value
 *   PATCH /api/tax-rates/:id/toggle — activate or deactivate a tax rate
 */

const express     = require('express');
const Decimal     = require('decimal.js');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();
router.use(auth);

const dec = (v) => new Decimal(v ?? 0);

/**
 * GET /api/tax-rates
 * Returns all tax rates with their linked recoverable account info.
 * Pass ?all=true to include inactive rates (for Settings screen).
 */
router.get('/', async (req, res, next) => {
  try {
    const { all } = req.query;

    const query = db('tax_rates as tr')
      .leftJoin('accounts as a', 'a.id', 'tr.recoverable_account_id')
      .select(
        'tr.id',
        'tr.name',
        'tr.rate',
        'tr.rebate_percentage',
        'tr.is_active',
        'tr.recoverable_account_id',
        'a.code as recoverable_account_code',
        'a.name as recoverable_account_name',
      )
      .orderBy('tr.name', 'asc');

    if (!all) {
      query.where('tr.is_active', true);
    }

    const taxRates = await query;

    res.json({
      tax_rates: taxRates.map(tr => ({
        ...tr,
        rate: parseFloat(tr.rate),
        rebate_percentage: parseFloat(tr.rebate_percentage),
      })),
    });
  } catch (err) { next(err); }
});

/**
 * PUT /api/tax-rates/:id
 * Update the rate value of an existing tax rate.
 * Admin only — changing rates affects how future bills are calculated.
 */
router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rate } = req.body;

    if (rate === undefined || rate === null) {
      return res.status(400).json({ errors: ['rate is required'] });
    }

    const rateDecimal = dec(rate);

    if (rateDecimal.lte(0) || rateDecimal.gte(1)) {
      return res.status(400).json({ errors: ['rate must be between 0 and 1 (e.g. 0.13 for 13%)'] });
    }

    if (rateDecimal.decimalPlaces() > 4) {
      return res.status(400).json({ errors: ['rate cannot have more than 4 decimal places'] });
    }

    const taxRate = await db('tax_rates').where({ id }).first();
    if (!taxRate) {
      return res.status(404).json({ error: 'Tax rate not found' });
    }

    const [updated] = await db('tax_rates')
      .where({ id })
      .update({
        rate:       rateDecimal.toFixed(4),
        updated_at: db.fn.now(),
      })
      .returning('*');

    res.json({
      tax_rate: {
        ...updated,
        rate: parseFloat(updated.rate),
        rebate_percentage: parseFloat(updated.rebate_percentage),
      },
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /api/tax-rates/:id/toggle
 * Activate or deactivate a tax rate.
 * Deactivated rates no longer appear in the bill entry dropdown.
 * Admin only.
 */
router.patch('/:id/toggle', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const taxRate = await db('tax_rates').where({ id }).first();
    if (!taxRate) {
      return res.status(404).json({ error: 'Tax rate not found' });
    }

    const [updated] = await db('tax_rates')
      .where({ id })
      .update({
        is_active:  !taxRate.is_active,
        updated_at: db.fn.now(),
      })
      .returning('*');

    res.json({
      tax_rate: {
        ...updated,
        rate: parseFloat(updated.rate),
        rebate_percentage: parseFloat(updated.rebate_percentage),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
