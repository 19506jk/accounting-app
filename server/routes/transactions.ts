import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
  ApiErrorResponse,
  ApiValidationErrorResponse,
  CreateTransactionInput,
  GetBillMatchesInput,
  GetBillMatchesResult,
  ImportTransactionsInput,
  ImportTransactionsResult,
  MessageResponse,
  TransactionCreateResult,
  TransactionDetail,
  TransactionResponse,
  TransactionsListResponse,
  TransactionsQuery,
  UpdateTransactionInput,
} from '@shared/contracts';

const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
import transactionService = require('../services/transactions');
import transactionListService = require('../services/transactions/list');
import transactionImportService = require('../services/transactions/imports');
import transactionBillMatchService = require('../services/transactions/billMatches');

const router = express.Router();
router.use(auth);

router.get(
  '/',
  async (
    req: Request<{}, TransactionsListResponse | ApiErrorResponse, unknown, TransactionsQuery>,
    res: Response<TransactionsListResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const result = await transactionListService.listTransactions(req.query);
      res.json(result);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 400) {
        return res.status(400).json({ error: (err as Error).message });
      }
      next(err);
    }
  }
);

router.post(
  '/import/bill-matches',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, GetBillMatchesResult | ApiValidationErrorResponse, GetBillMatchesInput>,
    res: Response<GetBillMatchesResult | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const result = await transactionBillMatchService.getBillMatchSuggestions(req.body);
      return res.json(result);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const validationErrors = (err as { validationErrors?: string[] }).validationErrors;
      if (statusCode && validationErrors?.length) {
        return res.status(statusCode).json({ errors: validationErrors });
      }
      next(err);
    }
  }
);

router.post(
  '/import',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, ImportTransactionsResult | ApiValidationErrorResponse | ApiErrorResponse, ImportTransactionsInput>,
    res: Response<ImportTransactionsResult | ApiValidationErrorResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const result = await transactionImportService.importTransactions(req.body, req.user!.id);
      return res.json(result);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const validationErrors = (err as { validationErrors?: string[] }).validationErrors;
      if (statusCode && validationErrors?.length) {
        return res.status(statusCode).json({ errors: validationErrors });
      }
      next(err);
    }
  }
);

router.get(
  '/:id',
  async (
    req: Request<{ id: string }>,
    res: Response<TransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const detail = await transactionService.getTransactionDetailById(id);
      if (!detail) return res.status(404).json({ error: 'Transaction not found' });
      res.json({ transaction: detail });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, { transaction: TransactionCreateResult } | ApiErrorResponse | ApiValidationErrorResponse, CreateTransactionInput>,
    res: Response<{ transaction: TransactionCreateResult } | ApiErrorResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const transaction = await transactionService.createTransaction(req.body, req.user!.id);
      res.status(201).json({ transaction });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const validationErrors = (err as { validationErrors?: string[] }).validationErrors;
      if (statusCode === 400 && validationErrors?.length) {
        return res.status(400).json({ errors: validationErrors });
      }
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, { transaction: TransactionDetail } | ApiErrorResponse | ApiValidationErrorResponse, UpdateTransactionInput>,
    res: Response<{ transaction: TransactionDetail } | ApiErrorResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const transaction = await transactionService.updateTransaction(id, req.body);

      res.json({
        transaction,
      });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const validationErrors = (err as { validationErrors?: string[] }).validationErrors;
      if (statusCode === 400) {
        if (validationErrors?.length) return res.status(400).json({ errors: validationErrors });
        return res.status(400).json({ error: (err as Error).message || 'Invalid transaction update' });
      }
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireRole('admin'),
  async (
    req: Request<{ id: string }>,
    res: Response<MessageResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      await transactionService.deleteTransaction(id);
      res.json({ message: 'Transaction deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
