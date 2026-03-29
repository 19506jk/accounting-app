const express     = require('express');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();
router.use(auth);

/**
 * GET /api/settings
 * Return all settings as a flat key-value object.
 * Also returns the full list with labels for the settings UI.
 */
router.get('/', async (req, res, next) => {
  try {
    const rows = await db('settings').orderBy('id', 'asc');

    // Flat map for easy consumption: { church_name: "Grace Church", ... }
    const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    res.json({ settings: rows, values });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/settings
 * Admin only — bulk update settings.
 * Body: { church_name: "Grace Church", church_city: "Gravenhurst", ... }
 * Only updates keys that already exist — unknown keys are ignored.
 */
router.put('/', requireRole('admin'), async (req, res, next) => {
  try {
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Request body must be a key-value object' });
    }

    // Only allow updating keys that exist in the DB
    const existingKeys = await db('settings').select('key');
    const validKeys    = new Set(existingKeys.map((r) => r.key));

    const updatePromises = Object.entries(updates)
      .filter(([key]) => validKeys.has(key))
      .map(([key, value]) =>
        db('settings')
          .where({ key })
          .update({ value: value || null, updated_at: db.fn.now() })
      );

    await Promise.all(updatePromises);

    // Return updated settings
    const rows   = await db('settings').orderBy('id', 'asc');
    const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    res.json({ settings: rows, values });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
