import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');
import Decimal from 'decimal.js';

import type { AccountBudgetRow, ApiErrorResponse, BudgetResponse } from '@shared/contracts';
import { getFiscalStartMonth, getFiscalYearDateRange } from '../utils/fiscalYear.js';

const db = require('../db') as Knex;
const auth = require('../middleware/auth.js');
const requireRole = require('../middleware/roles.js');

const router = express.Router();
router.use(auth);
router.use(requireRole('admin'));

const dec = (v: string | number | null | undefined) => new Decimal(v ?? 0);

type ActualsRow = { account_id: number; total_debit: string | number; total_credit: string | number };

// Sum posted (non-voided, non-closing) journal-entry debits/credits per account
// within a date range — mirrors the P&L report's actuals so the figures agree.
async function actualsByAccount(period_start: string, period_end: string): Promise<Map<number, ActualsRow>> {
  const rows = await db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .where('t.is_voided', false)
    .where('t.is_closing_entry', false)
    .where('t.date', '>=', period_start)
    .where('t.date', '<=', period_end)
    .groupBy('je.account_id')
    .select(
      'je.account_id',
      db.raw('COALESCE(SUM(je.debit), 0) as total_debit'),
      db.raw('COALESCE(SUM(je.credit), 0) as total_credit'),
    ) as ActualsRow[];
  return new Map(rows.map((r) => [r.account_id, r]));
}

// Net actual for an account: INCOME nets credit−debit, EXPENSE nets debit−credit.
function netActual(actuals: ActualsRow | undefined, type: 'INCOME' | 'EXPENSE'): number {
  if (!actuals) return 0;
  const net = type === 'INCOME'
    ? dec(actuals.total_credit).minus(dec(actuals.total_debit))
    : dec(actuals.total_debit).minus(dec(actuals.total_credit));
  return parseFloat(net.toFixed(2));
}

router.get(
  '/',
  async (
    req: Request<{}, BudgetResponse | ApiErrorResponse, never, { fiscal_year?: string }>,
    res: Response<BudgetResponse | ApiErrorResponse>,
    next: NextFunction,
  ) => {
    try {
      const fiscalYear = parseInt(req.query.fiscal_year ?? '', 10);
      if (!fiscalYear || fiscalYear < 1) {
        return res.status(400).json({ error: 'fiscal_year query parameter is required and must be a positive integer.' });
      }

      const fiscalStartMonth = await getFiscalStartMonth(db);
      const prior = getFiscalYearDateRange(fiscalYear - 1, fiscalStartMonth);
      const current = getFiscalYearDateRange(fiscalYear, fiscalStartMonth);

      const accounts = await db('accounts as a')
        .leftJoin('account_budgets as cb', function () {
          this.on('cb.account_id', 'a.id').andOnVal('cb.fiscal_year', fiscalYear);
        })
        .leftJoin('account_budgets as pb', function () {
          this.on('pb.account_id', 'a.id').andOnVal('pb.fiscal_year', fiscalYear - 1);
        })
        .whereIn('a.type', ['INCOME', 'EXPENSE'])
        .where('a.is_active', true)
        .orderByRaw("CASE a.type WHEN 'INCOME' THEN 1 WHEN 'EXPENSE' THEN 2 END")
        .orderBy('a.code', 'asc')
        .select(
          'a.id as account_id',
          'a.code as account_code',
          'a.name as account_name',
          'a.type as account_type',
          db.raw('COALESCE(cb.amount, 0) as budget_amount'),
          db.raw('COALESCE(pb.amount, 0) as prior_budget_amount'),
        ) as Array<{
          account_id: number;
          account_code: string;
          account_name: string;
          account_type: 'INCOME' | 'EXPENSE';
          budget_amount: string | number;
          prior_budget_amount: string | number;
        }>;

      const [currentActuals, priorActuals] = await Promise.all([
        actualsByAccount(current.period_start, current.period_end),
        actualsByAccount(prior.period_start, prior.period_end),
      ]);

      const rows: AccountBudgetRow[] = accounts.map((a) => ({
        account_id: a.account_id,
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
        budget_amount: parseFloat(dec(a.budget_amount).toFixed(2)),
        actual_amount: netActual(currentActuals.get(a.account_id), a.account_type),
        prior_budget_amount: parseFloat(dec(a.prior_budget_amount).toFixed(2)),
        prior_actual_amount: netActual(priorActuals.get(a.account_id), a.account_type),
      }));

      res.json({ rows });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/:accountId',
  async (
    req: Request<{ accountId: string }, { row: AccountBudgetRow } | ApiErrorResponse, { fiscal_year?: unknown; amount?: unknown }>,
    res: Response<{ row: AccountBudgetRow } | ApiErrorResponse>,
    next: NextFunction,
  ) => {
    try {
      const accountId = parseInt(req.params.accountId, 10);
      const fiscalYear = typeof req.body.fiscal_year === 'number' ? req.body.fiscal_year : parseInt(String(req.body.fiscal_year ?? ''), 10);
      const amount = typeof req.body.amount === 'number' ? req.body.amount : parseFloat(String(req.body.amount ?? ''));

      if (!accountId || accountId < 1) return res.status(400).json({ error: 'Invalid accountId.' });
      if (!fiscalYear || fiscalYear < 1) return res.status(400).json({ error: 'fiscal_year must be a positive integer.' });
      if (isNaN(amount) || amount < 0) return res.status(400).json({ error: 'amount must be a non-negative number.' });

      const account = await db('accounts').where({ id: accountId }).first() as { type: string } | undefined;
      if (!account) return res.status(404).json({ error: 'Account not found.' });
      if (account.type !== 'INCOME' && account.type !== 'EXPENSE') {
        return res.status(422).json({ error: 'Budgets can only be set for INCOME and EXPENSE accounts.' });
      }

      const normalizedAmount = parseFloat(dec(amount).toFixed(2));

      await db('account_budgets')
        .insert({ account_id: accountId, fiscal_year: fiscalYear, amount: normalizedAmount, created_at: db.fn.now(), updated_at: db.fn.now() })
        .onConflict(['account_id', 'fiscal_year'])
        .merge({ amount: normalizedAmount, updated_at: db.fn.now() });

      res.json({
        row: {
          account_id: accountId,
          account_code: '',
          account_name: '',
          account_type: account.type as 'INCOME' | 'EXPENSE',
          budget_amount: normalizedAmount,
          actual_amount: 0,
          prior_budget_amount: 0,
          prior_actual_amount: 0,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export = router;
