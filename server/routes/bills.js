const express     = require('express');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const {
  createBill,
  updateBill,
  payBill,
  voidBill,
  getAgingReport,
  getUnpaidSummary,
  getBillWithLineItems,
} = require('../services/bills');

const router = express.Router();
router.use(auth);

/**
 * GET /api/bills
 * List bills with optional filters
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, contact_id, from, to, limit = 100, offset = 0 } = req.query;

    const query = db('bills as b')
      .leftJoin('contacts as c', 'c.id', 'b.contact_id')
      .leftJoin('funds as f', 'f.id', 'b.fund_id')
      .leftJoin('users as u', 'u.id', 'b.created_by')
      .leftJoin('transactions as t', 't.id', 'b.created_transaction_id')
      .select(
        'b.*',
        'c.name as vendor_name',
        'f.name as fund_name',
        'u.name as created_by_name',
        't.is_voided',
      )
      .orderBy('b.created_at', 'desc');

    // Apply filters
    if (status) {
      if (Array.isArray(status)) {
        query.whereIn('b.status', status);
      } else {
        query.where('b.status', status);
      }
    }

    if (contact_id) {
      query.where('b.contact_id', contact_id);
    }

    if (from) {
      query.where('b.date', '>=', from);
    }

    if (to) {
      query.where('b.date', '<=', to);
    }

    // Get total count - separate query without joins to avoid GROUP BY requirement
    const countQuery = db('bills as b').count('b.id as count');
    if (status) {
      if (Array.isArray(status)) {
        countQuery.whereIn('b.status', status);
      } else {
        countQuery.where('b.status', status);
      }
    }
    if (contact_id) {
      countQuery.where('b.contact_id', contact_id);
    }
    if (from) {
      countQuery.where('b.date', '>=', from);
    }
    if (to) {
      countQuery.where('b.date', '<=', to);
    }
    const [{ count }] = await countQuery;

    // Apply pagination
    const cap = Math.min(parseInt(limit, 10), 200);
    const off = parseInt(offset, 10) || 0;
    query.limit(cap).offset(off);

    const bills = await query;

    // Get line items for each bill
    const billIds = bills.map(b => b.id);
    const lineItemsMap = {};
    if (billIds.length > 0) {
      const lineItemsResult = await db('bill_line_items')
        .whereIn('bill_id', billIds)
        .select('bill_id', 'id', 'expense_account_id', 'amount', 'description');
      
      lineItemsResult.forEach(li => {
        if (!lineItemsMap[li.bill_id]) lineItemsMap[li.bill_id] = [];
        lineItemsMap[li.bill_id].push({
          id: li.id,
          expense_account_id: li.expense_account_id,
          amount: parseFloat(li.amount),
          description: li.description,
        });
      });
    }

    res.json({
      bills: bills.map(b => ({
        ...b,
        amount: parseFloat(b.amount),
        amount_paid: parseFloat(b.amount_paid),
        line_items: lineItemsMap[b.id] || [],
      })),
      total: parseInt(count, 10),
      limit: cap,
      offset: off,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bills/summary
 * Unpaid bills summary
 */
router.get('/summary', async (req, res, next) => {
  try {
    const summary = await getUnpaidSummary();
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bills/reports/aging
 * Aging report - unpaid bills grouped by age
 */
router.get('/reports/aging', async (req, res, next) => {
  try {
    const { as_of } = req.query;
    const asOfDate = as_of || new Date();

    const report = await getAgingReport(asOfDate);
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bills/:id
 * Get single bill with full details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const bill = await getBillWithLineItems(id);

    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    // Get is_voided flag from the original transaction
    let is_voided = false;
    if (bill.created_transaction_id) {
      const transaction = await db('transactions')
        .where({ id: bill.created_transaction_id })
        .select('is_voided')
        .first();
      is_voided = transaction?.is_voided || false;
    }

    let paymentTransaction = null;
    if (bill.transaction_id) {
      paymentTransaction = await db('transactions as t')
        .leftJoin('users as u', 'u.id', 't.created_by')
        .where('t.id', bill.transaction_id)
        .select(
          't.id',
          't.date',
          't.description',
          't.reference_no',
          'u.name as created_by_name',
        )
        .first();
    }

    res.json({
      bill: {
        ...bill,
        is_voided,
        payment_transaction: paymentTransaction,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bills
 * Create new bill with journal entries
 */
router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const result = await createBill(req.body, req.user.id);

    if (result.errors) {
      return res.status(400).json({ errors: result.errors });
    }

    res.status(201).json({ bill: result.bill, transaction: result.transaction });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/bills/:id
 * Update unpaid bill
 */
router.put('/:id', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await updateBill(id, req.body, req.user.id);

    if (result.errors) {
      return res.status(400).json({ errors: result.errors });
    }

    res.json({ bill: result.bill });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bills/:id/pay
 * Pay bill in full
 */
router.post('/:id/pay', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await payBill(id, req.body, req.user.id);

    if (result.errors) {
      const status = result.outstanding !== undefined ? 400 : 400;
      return res.status(status).json({ 
        errors: result.errors,
        outstanding: result.outstanding,
      });
    }

    res.json({ bill: result.bill, transaction: result.transaction });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bills/:id/void
 * Void unpaid bill
 */
router.post('/:id/void', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await voidBill(id, req.user.id);

    if (result.errors) {
      return res.status(400).json({ errors: result.errors });
    }

    res.json({ bill: result.bill, transaction: result.transaction });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
