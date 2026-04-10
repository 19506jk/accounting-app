import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
  ApiErrorResponse,
  ApiValidationErrorResponse,
  BalanceSheetReportData,
  DonorDetailReportData,
  DonorSummaryReportData,
  LedgerReportData,
  PLReportData,
  ReportEnvelope,
  ReportType,
  TrialBalanceReportData,
} from '@shared/contracts';

const auth = require('../middleware/auth');
import reports = require('../services/reports');
import { isValidDateOnly } from '../utils/date.js';

const { getPL, getBalanceSheet, getLedger, getTrialBalance, getDonorSummary, getDonorDetail } = reports;

const router = express.Router();
router.use(auth);

type ReportErrorResponse = ApiErrorResponse | ApiValidationErrorResponse;

type DateRangeFiltersResponse = {
  from: string;
  to: string;
  fund_id: string | null;
};

type BalanceSheetFiltersResponse = {
  as_of: string;
  fund_id: string | null;
};

type LedgerFiltersResponse = DateRangeFiltersResponse & {
  account_id: string | null;
};

type DonorSummaryFiltersResponse = DateRangeFiltersResponse & {
  account_ids: number[] | null;
};

type DonorDetailFiltersResponse = DateRangeFiltersResponse & {
  contact_id: string | null;
  account_ids: number[] | null;
};

type PLReportRouteResponse = {
  report: ReportEnvelope<'pl', DateRangeFiltersResponse, PLReportData>;
};

type BalanceSheetReportRouteResponse = {
  report: ReportEnvelope<'balance-sheet', BalanceSheetFiltersResponse, BalanceSheetReportData>;
};

type LedgerReportRouteResponse = {
  report: ReportEnvelope<'ledger', LedgerFiltersResponse, LedgerReportData>;
};

type TrialBalanceReportRouteResponse = {
  report: ReportEnvelope<'trial-balance', BalanceSheetFiltersResponse, TrialBalanceReportData>;
};

type DonorSummaryReportRouteResponse = {
  report: ReportEnvelope<'donors-summary', DonorSummaryFiltersResponse, DonorSummaryReportData>;
};

type DonorDetailReportRouteResponse = {
  report: ReportEnvelope<'donors-detail', DonorDetailFiltersResponse, DonorDetailReportData>;
};

interface DateRangeQuery {
  from?: string;
  to?: string;
  fund_id?: string;
  account_ids?: string;
}

interface BalanceSheetQuery {
  as_of?: string;
  fund_id?: string;
}

interface LedgerQuery extends DateRangeQuery {
  account_id?: string;
}

interface DonorDetailQuery extends DateRangeQuery {
  contact_id?: string;
}

function parseAccountIds(rawIds: unknown): { accountIds: number[] | null; error: string | null } {
  if (typeof rawIds === 'undefined') {
    return { accountIds: null, error: null };
  }
  if (typeof rawIds !== 'string') {
    return { accountIds: null, error: 'account_ids must be a comma-separated string' };
  }

  const tokens = rawIds.split(',').map((token) => token.trim());
  const hasInvalidToken = tokens.some((token) => !/^\d+$/.test(token));
  if (hasInvalidToken) {
    return { accountIds: null, error: 'account_ids must be comma-separated positive integers' };
  }

  const accountIds = tokens.map(Number);
  if (accountIds.some((id) => id <= 0)) {
    return { accountIds: null, error: 'account_ids must be positive integers' };
  }

  return { accountIds, error: null };
}

function envelope<TType extends ReportType, TFilters, TData>(
  type: TType,
  filters: TFilters,
  data: TData
): { report: ReportEnvelope<TType, TFilters, TData> } {
  return {
    report: {
      type,
      generated_at: new Date().toISOString(),
      filters,
      data,
    },
  };
}

function validateDates({ from, to, asOf }: { from?: string; to?: string; asOf?: string } = {}) {
  const errors: string[] = [];

  if (from && !isValidDateOnly(from)) errors.push('from is not a valid date (YYYY-MM-DD)');
  if (to && !isValidDateOnly(to)) errors.push('to is not a valid date (YYYY-MM-DD)');
  if (asOf && !isValidDateOnly(asOf)) errors.push('as_of is not a valid date (YYYY-MM-DD)');
  if (from && to && from > to) errors.push('from must be before or equal to to');

  return errors;
}

router.get(
  '/pl',
  async (
    req: Request<{}, PLReportRouteResponse | ReportErrorResponse, unknown, DateRangeQuery>,
    res: Response<PLReportRouteResponse | ReportErrorResponse>,
    next: NextFunction
  ) => {
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
  }
);

router.get(
  '/balance-sheet',
  async (
    req: Request<{}, BalanceSheetReportRouteResponse | ReportErrorResponse, unknown, BalanceSheetQuery>,
    res: Response<BalanceSheetReportRouteResponse | ReportErrorResponse>,
    next: NextFunction
  ) => {
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
  }
);

router.get(
  '/ledger',
  async (
    req: Request<{}, LedgerReportRouteResponse | ReportErrorResponse, unknown, LedgerQuery>,
    res: Response<LedgerReportRouteResponse | ReportErrorResponse>,
    next: NextFunction
  ) => {
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
        fundId: fund_id || null,
        accountId: account_id || null,
      });

      res.json(envelope('ledger', { from, to, account_id: account_id || null, fund_id: fund_id || null }, data));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/trial-balance',
  async (
    req: Request<{}, TrialBalanceReportRouteResponse | ReportErrorResponse, unknown, BalanceSheetQuery>,
    res: Response<TrialBalanceReportRouteResponse | ReportErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { as_of, fund_id } = req.query;

      if (!as_of) {
        return res.status(400).json({ error: 'as_of query parameter is required' });
      }

      const errors = validateDates({ asOf: as_of });
      if (errors.length) return res.status(400).json({ errors });

      const data = await getTrialBalance({ asOf: as_of, fundId: fund_id || null });
      res.json(envelope('trial-balance', { as_of, fund_id: fund_id || null }, data));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/donors/summary',
  async (
    req: Request<{}, DonorSummaryReportRouteResponse | ReportErrorResponse, unknown, DateRangeQuery>,
    res: Response<DonorSummaryReportRouteResponse | ReportErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { from, to, fund_id, account_ids } = req.query;

      if (!from || !to) {
        return res.status(400).json({ error: 'from and to query parameters are required' });
      }

      const errors = validateDates({ from, to });
      if (errors.length) return res.status(400).json({ errors });

      const { accountIds, error } = parseAccountIds(account_ids);
      if (error) return res.status(400).json({ error });

      const data = await getDonorSummary({ from, to, fundId: fund_id || null, accountIds });
      res.json(envelope('donors-summary', { from, to, fund_id: fund_id || null, account_ids: accountIds }, data));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/donors/detail',
  async (
    req: Request<{}, DonorDetailReportRouteResponse | ReportErrorResponse, unknown, DonorDetailQuery>,
    res: Response<DonorDetailReportRouteResponse | ReportErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { from, to, fund_id, contact_id, account_ids } = req.query;

      if (!from || !to) {
        return res.status(400).json({ error: 'from and to query parameters are required' });
      }

      const errors = validateDates({ from, to });
      if (errors.length) return res.status(400).json({ errors });

      const { accountIds, error } = parseAccountIds(account_ids);
      if (error) return res.status(400).json({ error });

      const data = await getDonorDetail({
        from,
        to,
        fundId: fund_id || null,
        contactId: contact_id || null,
        accountIds,
      });

      res.json(
        envelope(
          'donors-detail',
          { from, to, fund_id: fund_id || null, contact_id: contact_id || null, account_ids: accountIds },
          data
        )
      );
    } catch (err) {
      next(err);
    }
  }
);

export = router;
