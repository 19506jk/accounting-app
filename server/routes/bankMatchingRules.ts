import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');

import type {
  ApiErrorResponse,
  BankMatchingRuleDraft,
  BankMatchingRuleResponse,
  BankMatchingRulesResponse,
  MessageResponse,
  SimulateBankMatchingRuleInput,
  SimulateBankMatchingRuleResult,
} from '@shared/contracts';
import {
  listBankMatchingRules,
  simulateBankMatchingRule,
  softDeleteBankMatchingRule,
  upsertBankMatchingRule,
  validateBankMatchingRuleDraft,
} from '../services/bankTransactions/ruleEngine.js';

const db = require('../db');
const auth = require('../middleware/auth.js');
const requireRole = require('../middleware/roles.js');

const router = express.Router();
router.use(auth);

function parseIntegerId(value: string, field: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const err = new Error(`${field} must be a positive integer`) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

function asBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).toLowerCase().trim();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

router.get(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, BankMatchingRulesResponse | ApiErrorResponse, unknown, { include_inactive?: string }>,
    res: Response<BankMatchingRulesResponse | ApiErrorResponse>,
    next: NextFunction,
  ) => {
    try {
      const includeInactive = asBoolean(req.query.include_inactive, true);
      const rules = await listBankMatchingRules(db, includeInactive);
      return res.json({ rules });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, BankMatchingRuleResponse | ApiErrorResponse, BankMatchingRuleDraft>,
    res: Response<BankMatchingRuleResponse | ApiErrorResponse>,
    next: NextFunction,
  ) => {
    try {
      await validateBankMatchingRuleDraft(req.body);
      const rule = await db.transaction(async (trx: Knex.Transaction) => {
        const ruleId = await upsertBankMatchingRule(req.body, req.user?.id ?? null, trx);
        const rules = await listBankMatchingRules(trx, true);
        return rules.find((item) => item.id === ruleId) || null;
      });

      if (!rule) {
        return res.status(500).json({ error: 'Failed to load created rule' });
      }
      return res.status(201).json({ rule });
    } catch (err) {
      if ((err as Error).message) {
        return res.status(400).json({ error: (err as Error).message });
      }
      return next(err);
    }
  },
);

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BankMatchingRuleResponse | ApiErrorResponse, BankMatchingRuleDraft>,
    res: Response<BankMatchingRuleResponse | ApiErrorResponse>,
    next: NextFunction,
  ) => {
    try {
      const ruleId = parseIntegerId(req.params.id, 'id');
      await validateBankMatchingRuleDraft(req.body);
      const rule = await db.transaction(async (trx: Knex.Transaction) => {
        await upsertBankMatchingRule(req.body, req.user?.id ?? null, trx, ruleId);
        const rules = await listBankMatchingRules(trx, true);
        return rules.find((item) => item.id === ruleId) || null;
      });

      if (!rule) {
        return res.status(404).json({ error: 'Rule not found' });
      }
      return res.json({ rule });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      if ((err as Error).message) {
        return res.status(400).json({ error: (err as Error).message });
      }
      return next(err);
    }
  },
);

router.delete(
  '/:id',
  requireRole('admin'),
  async (
    req: Request<{ id: string }>,
    res: Response<MessageResponse | ApiErrorResponse>,
    next: NextFunction,
  ) => {
    try {
      const ruleId = parseIntegerId(req.params.id, 'id');
      await db.transaction(async (trx: Knex.Transaction) => {
        await softDeleteBankMatchingRule(ruleId, req.user?.id ?? null, trx);
      });
      return res.json({ message: 'Rule deleted' });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  },
);

router.post(
  '/simulate',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, SimulateBankMatchingRuleResult | ApiErrorResponse, SimulateBankMatchingRuleInput>,
    res: Response<SimulateBankMatchingRuleResult | ApiErrorResponse>,
    next: NextFunction,
  ) => {
    try {
      if (!req.body?.rule) {
        return res.status(400).json({ error: 'rule is required' });
      }
      await validateBankMatchingRuleDraft(req.body.rule);
      const result = await db.transaction(async (trx: Knex.Transaction) => (
        simulateBankMatchingRule(req.body, trx)
      ));
      return res.json(result);
    } catch (err) {
      if ((err as Error).message) {
        return res.status(400).json({ error: (err as Error).message });
      }
      return next(err);
    }
  },
);

export = router;
