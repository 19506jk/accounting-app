const express = require('express');
const auth    = require('../middleware/auth');
const {
  getPL,
  getBalanceSheet,
  getLedger,
  getTrialBalance,
  getDonorSummary,
  getDonorDetail,
} = require('../services/reports');

const router = express.Router();
router.use(auth);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wrap a report result in the standard envelope.
 */
function envelope(type, filters, data) {
  return {
    report: {
      type,
      generated_at: new Date().toISOString(),
      filters,
      data,
    },
  };
}

/**
 * Validate that required date params are present and well-formed.
 */
function validateDates({ from, to, asOf } = {}) {
  const errors = [];
  const isValidDate = (d) => d && !isNaN(new Date(d).getTime());

  if (from  && !isValidDate(from))  errors.push('from is not a valid date (YYYY-MM-DD)');
  if (to    && !isValidDate(to))    errors.push('to is not a valid date (YYYY-MM-DD)');
  if (asOf  && !isValidDate(asOf))  errors.push('as_of is not a valid date (YYYY-MM-DD)');
  if (from  && to && from > to)     errors.push('from must be before or equal to to');

  return errors;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/reports/pl
 * Statement of Activities (P&L) for a date range.
 *
 * Required: ?from=YYYY-MM-DD &to=YYYY-MM-DD
 * Optional: ?fund_id=
 */
router.get('/pl', async (req, res, next) => {
  try {
    const { from, to, fund_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query parameters are required' });
    }

    const errors = validateDates({ from, to });
    if (errors.length) return res.status(400).json({ errors });

    const data = await getPL({ from, to, fundId: fund_id || null });

    res.json(envelope('pl', { from, to, fund_id: fund_id || null }, data));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/balance-sheet
 * Statement of Financial Position as of a given date.
 *
 * Required: ?as_of=YYYY-MM-DD
 * Optional: ?fund_id=
 */
router.get('/balance-sheet', async (req, res, next) => {
  try {
    const { as_of, fund_id } = req.query;

    if (!as_of) {
      return res.status(400).json({ error: 'as_of query parameter is required' });
    }

    const errors = validateDates({ asOf: as_of });
    if (errors.length) return res.status(400).json({ errors });

    const data = await getBalanceSheet({ asOf: as_of, fundId: fund_id || null });

    res.json(envelope('balance-sheet', { as_of, fund_id: fund_id || null }, data));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/ledger
 * General Ledger — all entries with running balances.
 *
 * Required: ?from=YYYY-MM-DD &to=YYYY-MM-DD
 * Optional: ?account_id=  (single account) ?fund_id=
 */
router.get('/ledger', async (req, res, next) => {
  try {
    const { from, to, account_id, fund_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query parameters are required' });
    }

    const errors = validateDates({ from, to });
    if (errors.length) return res.status(400).json({ errors });

    const data = await getLedger({
      from,
      to,
      fundId:    fund_id    || null,
      accountId: account_id || null,
    });

    res.json(envelope('ledger', { from, to, account_id: account_id || null, fund_id: fund_id || null }, data));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/trial-balance
 * Trial Balance — all accounts with net debit/credit totals.
 *
 * Required: ?from=YYYY-MM-DD &to=YYYY-MM-DD
 * Optional: ?fund_id=
 */
router.get('/trial-balance', async (req, res, next) => {
  try {
    const { from, to, fund_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query parameters are required' });
    }

    const errors = validateDates({ from, to });
    if (errors.length) return res.status(400).json({ errors });

    const data = await getTrialBalance({ from, to, fundId: fund_id || null });

    res.json(envelope('trial-balance', { from, to, fund_id: fund_id || null }, data));
  } catch (err) {
    next(err);
  }
});


/**
 * GET /api/reports/donors/summary
 * Income by donor — one row per donor with aggregated total.
 *
 * Required: ?from=YYYY-MM-DD &to=YYYY-MM-DD
 * Optional: ?fund_id=
 */
router.get('/donors/summary', async (req, res, next) => {
  try {
    const { from, to, fund_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query parameters are required' });
    }

    const errors = validateDates({ from, to });
    if (errors.length) return res.status(400).json({ errors });

    const data = await getDonorSummary({ from, to, fundId: fund_id || null });

    res.json(envelope('donors-summary', { from, to, fund_id: fund_id || null }, data));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/donors/detail
 * Income by donor — every transaction per donor.
 *
 * Required: ?from=YYYY-MM-DD &to=YYYY-MM-DD
 * Optional: ?fund_id=  ?contact_id=  (filter to single donor)
 */
router.get('/donors/detail', async (req, res, next) => {
  try {
    const { from, to, fund_id, contact_id } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query parameters are required' });
    }

    const errors = validateDates({ from, to });
    if (errors.length) return res.status(400).json({ errors });

    const data = await getDonorDetail({
      from,
      to,
      fundId:    fund_id    || null,
      contactId: contact_id || null,
    });

    res.json(envelope('donors-detail', {
      from, to,
      fund_id:    fund_id    || null,
      contact_id: contact_id || null,
    }, data));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
