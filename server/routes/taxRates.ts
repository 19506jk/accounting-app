import type { NextFunction, Request, Response } from 'express';
import express = require('express');
import Decimal from 'decimal.js';

import type {
  ApiErrorResponse,
  ApiValidationErrorResponse,
  TaxRateResponse,
  TaxRatesListResponse,
} from '@shared/contracts';

const db = require('../db');
const auth = require('../middleware/auth.js');
const requireRole = require('../middleware/roles.js');

const router = express.Router();
router.use(auth);

const dec = (value: string | number | null | undefined) => new Decimal(value ?? 0);

interface TaxRatesQuery {
  all?: string | boolean;
}

interface TaxRateRow {
  id: number;
  name: string;
  rate: string | number;
  rebate_percentage: string | number;
  is_active: boolean;
  recoverable_account_id: number | null;
  recoverable_account_code: string | null;
  recoverable_account_name: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
}

interface TaxRateParams {
  id: string;
}

function normalizeTaxRate(row: TaxRateRow): TaxRateResponse['tax_rate'] {
  return {
    ...row,
    rate: parseFloat(String(row.rate)),
    rebate_percentage: parseFloat(String(row.rebate_percentage)),
    recoverable_account_code: row.recoverable_account_code ?? null,
    recoverable_account_name: row.recoverable_account_name ?? null,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

router.get(
  '/',
  async (
    req: Request<{}, TaxRatesListResponse | ApiErrorResponse, unknown, TaxRatesQuery>,
    res: Response<TaxRatesListResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const showAll = req.query.all === 'true' || req.query.all === true;

      const query = db('tax_rates as tr')
        .leftJoin('accounts as a', 'a.id', 'tr.recoverable_account_id')
        .select(
          'tr.id',
          'tr.name',
          'tr.rate',
          'tr.rebate_percentage',
          'tr.is_active',
          'tr.recoverable_account_id',
          'tr.created_at',
          'tr.updated_at',
          'a.code as recoverable_account_code',
          'a.name as recoverable_account_name'
        )
        .orderBy('tr.name', 'asc');

      if (!showAll) {
        query.where('tr.is_active', true);
      }

      const taxRates = await query as TaxRateRow[];
      res.json({ tax_rates: taxRates.map(normalizeTaxRate) });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireRole('admin'),
  async (
    req: Request<
      TaxRateParams,
      TaxRateResponse | ApiErrorResponse | ApiValidationErrorResponse,
      { rate?: string | number | null }
    >,
    res: Response<TaxRateResponse | ApiErrorResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
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

      const taxRate = await db('tax_rates').where({ id }).first() as TaxRateRow | undefined;
      if (!taxRate) {
        return res.status(404).json({ error: 'Tax rate not found' });
      }

      const [updated] = await db('tax_rates')
        .where({ id })
        .update({
          rate: rateDecimal.toFixed(4),
          updated_at: db.fn.now(),
        })
        .returning('*') as TaxRateRow[];

      if (!updated) throw new Error('Unexpected missing tax rate after update');
      res.json({ tax_rate: normalizeTaxRate(updated) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/toggle',
  requireRole('admin'),
  async (
    req: Request<TaxRateParams, TaxRateResponse | ApiErrorResponse>,
    res: Response<TaxRateResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const taxRate = await db('tax_rates').where({ id }).first() as TaxRateRow | undefined;
      if (!taxRate) {
        return res.status(404).json({ error: 'Tax rate not found' });
      }

      const [updated] = await db('tax_rates')
        .where({ id })
        .update({
          is_active: !taxRate.is_active,
          updated_at: db.fn.now(),
        })
        .returning('*') as TaxRateRow[];

      if (!updated) throw new Error('Unexpected missing tax rate after toggle');
      res.json({ tax_rate: normalizeTaxRate(updated) });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
