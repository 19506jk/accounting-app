import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
  ApiErrorResponse,
  DonationReceiptAccountsResponse,
  DonationReceiptGenerateInput,
  DonationReceiptGeneratePdfResponse,
  DonationReceiptPreviewInput,
  DonationReceiptPreviewResponse,
  DonationReceiptTemplateResponse,
  UpdateDonationReceiptTemplateInput,
} from '@shared/contracts';
import {
  generateReceiptPdf,
  getReceiptAccounts,
  getReceiptTemplate,
  previewReceipt,
  saveReceiptTemplate,
} from '../services/donationReceipts.js';

const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

interface AccountsQuery {
  fiscal_year?: string;
}

function parseFiscalYear(raw: unknown) {
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    return { fiscalYear: null, error: 'fiscal_year must be a valid year' };
  }
  return { fiscalYear: year, error: null };
}

function parseAccountIds(raw: unknown) {
  if (!Array.isArray(raw)) return { accountIds: null, error: 'account_ids must be an array' };
  if (!raw.length) return { accountIds: null, error: 'At least one income account must be selected' };

  const accountIds = raw.map(Number);
  if (accountIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { accountIds: null, error: 'account_ids must contain positive integers' };
  }

  return { accountIds, error: null };
}

router.get(
  '/accounts',
  async (
    req: Request<{}, DonationReceiptAccountsResponse | ApiErrorResponse, unknown, AccountsQuery>,
    res: Response<DonationReceiptAccountsResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { fiscalYear, error } = parseFiscalYear(req.query.fiscal_year);
      if (error || fiscalYear === null) return res.status(400).json({ error: error || 'Invalid fiscal_year' });

      res.json(await getReceiptAccounts(fiscalYear));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/template',
  async (
    _req: Request,
    res: Response<DonationReceiptTemplateResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      res.json(await getReceiptTemplate());
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/template',
  async (
    req: Request<{}, DonationReceiptTemplateResponse | ApiErrorResponse, UpdateDonationReceiptTemplateInput>,
    res: Response<DonationReceiptTemplateResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const markdownBody = req.body?.markdown_body;
      if (typeof markdownBody !== 'string' || !markdownBody.trim()) {
        return res.status(400).json({ error: 'markdown_body is required' });
      }

      res.json(await saveReceiptTemplate(markdownBody, req.user!.id));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/preview',
  async (
    req: Request<{}, DonationReceiptPreviewResponse | ApiErrorResponse, DonationReceiptPreviewInput>,
    res: Response<DonationReceiptPreviewResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { fiscalYear, error: fiscalYearError } = parseFiscalYear(req.body?.fiscal_year);
      if (fiscalYearError || fiscalYear === null) {
        return res.status(400).json({ error: fiscalYearError || 'Invalid fiscal_year' });
      }

      const { accountIds, error: accountIdsError } = parseAccountIds(req.body?.account_ids);
      if (accountIdsError || accountIds === null) {
        return res.status(400).json({ error: accountIdsError || 'Invalid account_ids' });
      }

      res.json(await previewReceipt(fiscalYear, accountIds, req.body?.markdown_body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/generate-pdf',
  async (
    req: Request<{}, DonationReceiptGeneratePdfResponse | ApiErrorResponse, DonationReceiptGenerateInput>,
    res: Response<DonationReceiptGeneratePdfResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { fiscalYear, error: fiscalYearError } = parseFiscalYear(req.body?.fiscal_year);
      if (fiscalYearError || fiscalYear === null) {
        return res.status(400).json({ error: fiscalYearError || 'Invalid fiscal_year' });
      }

      const { accountIds, error: accountIdsError } = parseAccountIds(req.body?.account_ids);
      if (accountIdsError || accountIds === null) {
        return res.status(400).json({ error: accountIdsError || 'Invalid account_ids' });
      }

      res.json(await generateReceiptPdf(fiscalYear, accountIds, req.body?.markdown_body));
    } catch (err) {
      next(err);
    }
  }
);

export = router;
