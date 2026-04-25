import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');
import Decimal from 'decimal.js';

import type {
  ApiErrorResponse,
  FiscalPeriod,
  HardCloseExecuteResponse,
  HardCloseInvestigateResponse,
  HardClosePreflightResult,
  HardCloseProFormaLine,
  HardCloseUnreconciledAccount,
  ReopenFiscalPeriodBody,
} from '@shared/contracts';
import { getChurchToday, normalizeDateOnly } from '../utils/date.js';
import { getChurchTimeZone } from '../services/churchTimeZone.js';
import { acquireHardCloseLock } from '../utils/hardCloseGuard.js';
import { writeForensicEntry } from '../services/auditLog.js';

const db = require('../db') as Knex;
const auth = require('../middleware/auth.js');
const requireRole = require('../middleware/roles.js');

const router = express.Router();
router.use(auth);
router.use(requireRole('admin'));

const dec = (value: string | number | null | undefined) => new Decimal(value ?? 0);
const ZERO = dec(0);

type Executor = Knex | Knex.Transaction;

type FiscalPeriodRow = {
  id: number;
  fiscal_year: number;
  period_start: string | Date;
  period_end: string | Date;
  status: 'HARD_CLOSED';
  closing_transaction_id: number | null;
  closed_by: number | null;
  closed_at: string | Date;
};

type IncomeExpenseRow = {
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: 'INCOME' | 'EXPENSE';
  fund_id: number;
  fund_name: string;
  net_asset_account_id: number | null;
  net_asset_code: string | null;
  net_asset_name: string | null;
  total_debit: string | number;
  total_credit: string | number;
};

type SumRow = {
  total_debit: string | number | null;
  total_credit: string | number | null;
};

type FundSumRow = SumRow & { fund_id: number };

type LatestCloseRow = {
  period_end: string | Date;
  fiscal_year: number;
};

function toFiscalPeriod(row: FiscalPeriodRow): FiscalPeriod {
  return {
    id: row.id,
    fiscal_year: row.fiscal_year,
    period_start: normalizeDateOnly(row.period_start),
    period_end: normalizeDateOnly(row.period_end),
    status: row.status,
    closing_transaction_id: row.closing_transaction_id,
    closed_by: row.closed_by,
    closed_at: String(row.closed_at),
  };
}

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function getFiscalYearStartDate(asOf: string, fiscalStartMonth: number): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const fiscalYear = month >= fiscalStartMonth ? year : year - 1;
  return `${fiscalYear}-${String(fiscalStartMonth).padStart(2, '0')}-01`;
}

async function getFiscalStartMonth(executor: Executor): Promise<number> {
  const row = await executor('settings')
    .where({ key: 'fiscal_year_start' })
    .select('value')
    .first() as { value?: string | null } | undefined;
  return Math.max(1, Math.min(12, parseInt(row?.value ?? '1', 10) || 1));
}

async function deriveCloseWindow(executor: Executor) {
  const fiscalStartMonth = await getFiscalStartMonth(executor);
  const today = getChurchToday(getChurchTimeZone());
  const currentFiscalYearStart = getFiscalYearStartDate(today, fiscalStartMonth);
  const periodEnd = dayBefore(currentFiscalYearStart);
  const lastClose = await executor('fiscal_periods')
    .orderBy('period_end', 'desc')
    .select('period_end')
    .first() as { period_end: string | Date } | undefined;
  const periodStart = lastClose ? dayAfter(normalizeDateOnly(lastClose.period_end)) : '1900-01-01';

  return {
    fiscal_year: Number(periodEnd.slice(0, 4)),
    period_start: periodStart,
    period_end: periodEnd,
  };
}

function ensureClosable(periodStart: string, periodEnd: string) {
  if (periodEnd <= periodStart) {
    const err = new Error('No closable prior year found.') as Error & { status: number };
    err.status = 409;
    throw err;
  }
}

async function getIncomeExpenseRows(executor: Executor, periodStart: string, periodEnd: string): Promise<IncomeExpenseRow[]> {
  return executor('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .join('funds as f', 'f.id', 'je.fund_id')
    .leftJoin('accounts as na', 'na.id', 'f.net_asset_account_id')
    .where('t.is_voided', false)
    .where('t.date', '>=', periodStart)
    .where('t.date', '<=', periodEnd)
    .whereIn('a.type', ['INCOME', 'EXPENSE'])
    .select(
      'je.account_id',
      'a.code as account_code',
      'a.name as account_name',
      'a.type as account_type',
      'je.fund_id',
      'f.name as fund_name',
      'f.net_asset_account_id',
      'na.code as net_asset_code',
      'na.name as net_asset_name',
      executor.raw('COALESCE(SUM(je.debit), 0) AS total_debit'),
      executor.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy(
      'je.account_id',
      'a.code',
      'a.name',
      'a.type',
      'je.fund_id',
      'f.name',
      'f.net_asset_account_id',
      'na.code',
      'na.name'
    ) as Promise<IncomeExpenseRow[]>;
}

async function getPreflight(executor: Executor, periodStart: string, periodEnd: string, incomeExpenseRows: IncomeExpenseRow[]): Promise<HardClosePreflightResult> {
  const total = await executor('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .where('t.is_voided', false)
    .where('t.date', '>=', periodStart)
    .where('t.date', '<=', periodEnd)
    .select(
      executor.raw('COALESCE(SUM(je.debit), 0) AS total_debit'),
      executor.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .first() as SumRow | undefined;

  const fundTotals = await executor('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .where('t.is_voided', false)
    .where('t.date', '>=', periodStart)
    .where('t.date', '<=', periodEnd)
    .select(
      'je.fund_id',
      executor.raw('COALESCE(SUM(je.debit), 0) AS total_debit'),
      executor.raw('COALESCE(SUM(je.credit), 0) AS total_credit')
    )
    .groupBy('je.fund_id') as FundSumRow[];

  const assetAccounts = await executor('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('t.is_voided', false)
    .where('t.date', '>=', periodStart)
    .where('t.date', '<=', periodEnd)
    .where('a.type', 'ASSET')
    .distinct('a.id', 'a.code', 'a.name')
    .orderBy('a.code', 'asc') as Array<{ id: number; code: string; name: string }>;

  const unreconciledAccounts: HardCloseUnreconciledAccount[] = [];
  for (const account of assetAccounts) {
    const reconciliation = await executor('reconciliations')
      .where({ account_id: account.id, is_closed: true })
      .orderBy('statement_date', 'desc')
      .select('statement_date')
      .first() as { statement_date: string | Date } | undefined;
    const latestClosedDate = reconciliation ? normalizeDateOnly(reconciliation.statement_date) : null;
    if (!latestClosedDate || latestClosedDate < periodEnd) {
      unreconciledAccounts.push({
        account_id: account.id,
        account_code: account.code,
        account_name: account.name,
        required_through_date: periodEnd,
        latest_closed_statement_date: latestClosedDate,
      });
    }
  }

  const fundRows = new Map<number, IncomeExpenseRow>();
  for (const row of incomeExpenseRows) fundRows.set(row.fund_id, row);
  const noUnmappedFunds = [...fundRows.values()].every((row) => Boolean(row.net_asset_account_id));

  return {
    trial_balance_plugs: dec(total?.total_debit).equals(dec(total?.total_credit)),
    per_fund_balanced: fundTotals.every((row) => dec(row.total_debit).equals(dec(row.total_credit))),
    all_asset_accounts_reconciled: unreconciledAccounts.length === 0,
    unreconciled_accounts: unreconciledAccounts,
    no_unmapped_funds: noUnmappedFunds,
  };
}

function addLine(lines: HardCloseProFormaLine[], row: IncomeExpenseRow, debit: Decimal, credit: Decimal) {
  if (debit.isZero() && credit.isZero()) return;
  lines.push({
    account_id: row.account_id,
    account_code: row.account_code,
    account_name: row.account_name,
    account_type: row.account_type,
    fund_id: row.fund_id,
    fund_name: row.fund_name,
    debit: parseFloat(debit.toFixed(2)),
    credit: parseFloat(credit.toFixed(2)),
  });
}

function buildProFormaLines(rows: IncomeExpenseRow[]): HardCloseProFormaLine[] {
  const lines: HardCloseProFormaLine[] = [];
  const netByFund = new Map<number, Decimal>();
  const fundTargets = new Map<number, IncomeExpenseRow>();

  for (const row of rows) {
    const debit = dec(row.total_debit);
    const credit = dec(row.total_credit);
    const currentNet = netByFund.get(row.fund_id) || ZERO;
    fundTargets.set(row.fund_id, row);

    if (row.account_type === 'INCOME') {
      const signedNet = credit.minus(debit);
      addLine(lines, row, signedNet.gt(0) ? signedNet : ZERO, signedNet.lt(0) ? signedNet.abs() : ZERO);
      netByFund.set(row.fund_id, currentNet.plus(signedNet));
    } else {
      const signedNet = debit.minus(credit);
      addLine(lines, row, signedNet.lt(0) ? signedNet.abs() : ZERO, signedNet.gt(0) ? signedNet : ZERO);
      netByFund.set(row.fund_id, currentNet.minus(signedNet));
    }
  }

  for (const [fundId, fundNet] of netByFund.entries()) {
    if (fundNet.isZero()) continue;
    const target = fundTargets.get(fundId);
    if (!target?.net_asset_account_id) continue;
    lines.push({
      account_id: target.net_asset_account_id,
      account_code: target.net_asset_code || '3000',
      account_name: target.net_asset_name || 'Net Assets',
      account_type: 'EQUITY',
      fund_id: fundId,
      fund_name: target.fund_name,
      debit: parseFloat((fundNet.lt(0) ? fundNet.abs() : ZERO).toFixed(2)),
      credit: parseFloat((fundNet.gt(0) ? fundNet : ZERO).toFixed(2)),
    });
  }

  return lines;
}

function assertProFormaBalanced(lines: HardCloseProFormaLine[]) {
  const totalDebit = lines.reduce((sum, line) => sum.plus(line.debit), ZERO);
  const totalCredit = lines.reduce((sum, line) => sum.plus(line.credit), ZERO);
  if (!totalDebit.equals(totalCredit)) {
    throw new Error(`Generated hard close entry is not balanced: debits ${totalDebit.toFixed(2)}, credits ${totalCredit.toFixed(2)}.`);
  }
}

async function investigateHardClose(executor: Executor): Promise<HardCloseInvestigateResponse> {
  const { fiscal_year, period_start, period_end } = await deriveCloseWindow(executor);
  ensureClosable(period_start, period_end);

  const incomeExpenseRows = await getIncomeExpenseRows(executor, period_start, period_end);
  const preflight = await getPreflight(executor, period_start, period_end, incomeExpenseRows);
  const proFormaLines = buildProFormaLines(incomeExpenseRows);
  if (preflight.no_unmapped_funds) assertProFormaBalanced(proFormaLines);

  return {
    fiscal_year,
    period_start,
    period_end,
    pro_forma_lines: proFormaLines,
    preflight,
  };
}

function assertPreflightPasses(preflight: HardClosePreflightResult, periodEnd: string) {
  const failures: string[] = [];
  if (!preflight.trial_balance_plugs) failures.push('Trial balance does not plug for the period.');
  if (!preflight.per_fund_balanced) failures.push('One or more funds are not balanced for the period.');
  if (!preflight.all_asset_accounts_reconciled) {
    const accountList = preflight.unreconciled_accounts
      .map((account) => `${account.account_code} - ${account.account_name}`)
      .join(', ');
    failures.push(`Asset accounts not reconciled through ${periodEnd}: ${accountList}.`);
  }
  if (!preflight.no_unmapped_funds) failures.push('One or more funds with income/expense activity have no net-asset account mapping.');

  if (failures.length > 0) {
    const err = new Error(failures.join(' ')) as Error & { status: number };
    err.status = 422;
    throw err;
  }
}

router.post(
  '/investigate',
  async (_req: Request, res: Response<HardCloseInvestigateResponse | ApiErrorResponse>, next: NextFunction) => {
    try {
      res.json(await investigateHardClose(db));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/close',
  async (
    req: Request<{}, HardCloseExecuteResponse | ApiErrorResponse, { acknowledged?: boolean }>,
    res: Response<HardCloseExecuteResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      if (req.body.acknowledged !== true) {
        return res.status(400).json({ error: '`acknowledged` must be true to execute a hard close.' });
      }

      const result = await db.transaction(async (trx) => {
        await acquireHardCloseLock(trx);
        const investigation = await investigateHardClose(trx);
        assertPreflightPasses(investigation.preflight, investigation.period_end);
        assertProFormaBalanced(investigation.pro_forma_lines);

        const primaryFundId = investigation.pro_forma_lines[0]?.fund_id ?? null;
        const [transaction] = await trx('transactions')
          .insert({
            date: investigation.period_end,
            description: `Fiscal Year Close FY${investigation.fiscal_year}`,
            reference_no: `HARD-CLOSE-${investigation.fiscal_year}`,
            fund_id: primaryFundId,
            created_by: req.user!.id,
            is_closing_entry: true,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning(['id']) as Array<{ id: number }>;
        if (!transaction) throw new Error('Failed to create hard close transaction');

        if (investigation.pro_forma_lines.length > 0) {
          await trx('journal_entries').insert(investigation.pro_forma_lines.map((line) => ({
            transaction_id: transaction.id,
            account_id: line.account_id,
            fund_id: line.fund_id,
            debit: dec(line.debit).toFixed(2),
            credit: dec(line.credit).toFixed(2),
            memo: `Fiscal Year Close FY${investigation.fiscal_year}`,
            is_reconciled: false,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })));
        }

        const [period] = await trx('fiscal_periods')
          .insert({
            fiscal_year: investigation.fiscal_year,
            period_start: investigation.period_start,
            period_end: investigation.period_end,
            status: 'HARD_CLOSED',
            closing_transaction_id: transaction.id,
            closed_by: req.user!.id,
            closed_at: trx.fn.now(),
            created_at: trx.fn.now(),
          })
          .returning('*') as FiscalPeriodRow[];
        if (!period) throw new Error('Failed to create fiscal period');

        await writeForensicEntry(trx, {
          sessionToken: req.auditSessionToken,
          actor: {
            id: req.user!.id,
            name: req.user!.name,
            email: req.user!.email,
            role: req.user!.role,
          },
        }, {
          entity_type: 'fiscal_period',
          entity_id: period.id,
          entity_label: `FY${period.fiscal_year} (${normalizeDateOnly(period.period_start)} to ${normalizeDateOnly(period.period_end)})`,
          action: 'close',
          payload: {
            new: {
              fiscal_year: period.fiscal_year,
              closing_transaction_id: transaction.id,
            },
          },
        });

        return {
          fiscal_period: toFiscalPeriod(period),
          closing_transaction_id: transaction.id,
        };
      });

      res.status(201).json(result);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'This period was already closed.' });
      }
      next(err);
    }
  }
);

router.get(
  '/',
  async (_req: Request, res: Response<{ fiscal_periods: FiscalPeriod[] } | ApiErrorResponse>, next: NextFunction) => {
    try {
      const periods = await db('fiscal_periods')
        .orderBy('period_end', 'desc')
        .select('*') as FiscalPeriodRow[];
      res.json({ fiscal_periods: periods.map(toFiscalPeriod) });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id/reopen',
  async (
    req: Request<{ id: string }, { message: string } | ApiErrorResponse, ReopenFiscalPeriodBody>,
    res: Response<{ message: string } | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const reasonNote = (req.body?.reason_note ?? '').trim();
      if (!reasonNote) {
        return res.status(400).json({ error: 'reason_note is required for this operation' });
      }
      await db.transaction(async (trx) => {
        await acquireHardCloseLock(trx);
        const period = await trx('fiscal_periods')
          .where({ id: req.params.id })
          .first() as FiscalPeriodRow | undefined;
        if (!period || period.status !== 'HARD_CLOSED') {
          throw Object.assign(new Error('Fiscal period not found'), { status: 404 });
        }

        const latest = await trx('fiscal_periods')
          .max('period_end as period_end')
          .first() as { period_end: string | Date | null } | undefined;
        const latestPeriodEnd = latest?.period_end ? normalizeDateOnly(latest.period_end) : null;
        if (latestPeriodEnd && normalizeDateOnly(period.period_end) !== latestPeriodEnd) {
          throw Object.assign(new Error('Cannot reopen a period when later periods are still closed. Reopen in reverse chronological order.'), { status: 409 });
        }

        if (period.closing_transaction_id) {
          await trx('transactions')
            .where({ id: period.closing_transaction_id })
            .update({
              is_voided: true,
              updated_at: trx.fn.now(),
            });
        }

        await trx('fiscal_periods')
          .where({ id: req.params.id })
          .update({ closing_transaction_id: null });

        await writeForensicEntry(trx, {
          sessionToken: req.auditSessionToken,
          actor: {
            id: req.user!.id,
            name: req.user!.name,
            email: req.user!.email,
            role: req.user!.role,
          },
          reasonNote,
        }, {
          entity_type: 'fiscal_period',
          entity_id: period.id,
          entity_label: `FY${period.fiscal_year} (${normalizeDateOnly(period.period_start)} to ${normalizeDateOnly(period.period_end)})`,
          action: 'reopen',
          payload: {
            old: {
              fiscal_year: period.fiscal_year,
              closing_transaction_id: period.closing_transaction_id,
            },
            new: {
              closing_transaction_id: null,
            },
          },
        });
        await trx('fiscal_periods')
          .where({ id: req.params.id })
          .delete();
      });

      res.json({ message: 'Period reopened. Closing entry has been voided.' });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
