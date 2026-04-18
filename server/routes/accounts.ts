import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
  AccountResponse,
  AccountClass,
  AccountsListResponse,
  AccountsQuery,
  AccountSummary,
  AccountType,
  ApiErrorResponse,
  CreateAccountInput,
  MessageResponse,
  NormalBalanceSide,
  UpdateAccountInput,
} from '@shared/contracts';
import type { AccountListRow, AccountRow } from '../types/db';

const db = require('../db');
const auth = require('../middleware/auth.js');
const requireRole = require('../middleware/roles.js');

const router = express.Router();

router.use(auth);

const TYPE_ORDER: Record<AccountType, number> = {
  ASSET: 1,
  LIABILITY: 2,
  EQUITY: 3,
  INCOME: 4,
  EXPENSE: 5,
};

const VALID_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const VALID_ACCOUNT_CLASSES: AccountClass[] = [
  'ASSET',
  'CONTRA_ASSET',
  'LIABILITY',
  'CONTRA_LIABILITY',
  'EQUITY',
  'CONTRA_EQUITY',
  'INCOME',
  'CONTRA_INCOME',
  'EXPENSE',
  'CONTRA_EXPENSE',
];
const VALID_NORMAL_BALANCES: NormalBalanceSide[] = ['DEBIT', 'CREDIT'];
const DEFAULT_ACCOUNT_CLASS_BY_TYPE: Record<AccountType, AccountClass> = {
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
};

function inferDefaultAccountClass(type: AccountType): AccountClass {
  return DEFAULT_ACCOUNT_CLASS_BY_TYPE[type];
}

router.get(
  '/',
  async (
    req: Request<{}, AccountsListResponse | ApiErrorResponse, unknown, AccountsQuery>,
    res: Response<AccountsListResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { type, include_inactive } = req.query;

      const query = db('accounts as a')
        .leftJoin(
          db('funds').where('is_active', true).select('net_asset_account_id').as('af'),
          'af.net_asset_account_id',
          'a.id'
        )
        .select(
          'a.id',
          'a.code',
          'a.name',
          'a.type',
          'a.account_class',
          'a.normal_balance',
          'a.parent_id',
          'a.is_active',
          db.raw('(SELECT COUNT(*) FROM journal_entries je WHERE je.account_id = a.id) AS journal_entry_count'),
          db.raw(`
          CASE
            WHEN (SELECT COUNT(*) FROM journal_entries je WHERE je.account_id = a.id) > 0 THEN false
            WHEN af.net_asset_account_id IS NOT NULL THEN false
            ELSE true
          END AS is_deletable
        `)
        );

      if (String(include_inactive) !== 'true') {
        query.where('a.is_active', true);
      }

      if (type) {
        const normalized = String(type).toUpperCase() as AccountType;
        if (!VALID_TYPES.includes(normalized)) {
          return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
        }
        query.where('a.type', normalized);
      }

      const accounts = await query.orderBy('a.code', 'asc') as AccountListRow[];

      accounts.sort((a, b) => {
        const typeDiff = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
        if (typeDiff !== 0) return typeDiff;
        return a.code.localeCompare(b.code);
      });

      res.json({ accounts: accounts as AccountSummary[] });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  async (
    req: Request<{ id: string }>,
    res: Response<AccountResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const account = await db('accounts').where({ id: req.params.id }).first() as AccountRow | undefined;
      if (!account) return res.status(404).json({ error: 'Account not found' });
      res.json({ account: account as AccountSummary });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, AccountResponse | ApiErrorResponse, CreateAccountInput>,
    res: Response<AccountResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { code, name, type, parent_id } = req.body || {};
      const requestedClass = req.body?.account_class ? String(req.body.account_class).toUpperCase() : null;
      const requestedNormalBalance = req.body?.normal_balance !== undefined && req.body?.normal_balance !== null
        ? String(req.body.normal_balance).toUpperCase()
        : req.body?.normal_balance === null
          ? null
          : undefined;

      if (!code?.trim() || !name?.trim() || !type) {
        return res.status(400).json({ error: 'code, name, and type are required' });
      }

      const normalized = String(type).toUpperCase() as AccountType;
      if (!VALID_TYPES.includes(normalized)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
      }
      if (requestedClass && !VALID_ACCOUNT_CLASSES.includes(requestedClass as AccountClass)) {
        return res.status(400).json({
          error: `Invalid account_class. Must be one of: ${VALID_ACCOUNT_CLASSES.join(', ')}`,
        });
      }
      if (
        requestedNormalBalance !== undefined &&
        requestedNormalBalance !== null &&
        !VALID_NORMAL_BALANCES.includes(requestedNormalBalance as NormalBalanceSide)
      ) {
        return res.status(400).json({
          error: `Invalid normal_balance. Must be one of: ${VALID_NORMAL_BALANCES.join(', ')}`,
        });
      }

      const normalizedClass = (requestedClass as AccountClass | null) || inferDefaultAccountClass(normalized);

      const existing = await db('accounts').where({ code: code.trim() }).first() as AccountRow | undefined;
      if (existing) {
        return res.status(409).json({ error: `Account code ${code} already exists` });
      }

      if (parent_id) {
        const parent = await db('accounts').where({ id: parent_id }).first() as AccountRow | undefined;
        if (!parent) return res.status(400).json({ error: 'Parent account not found' });
        if (parent.type !== normalized) {
          return res.status(400).json({ error: 'Sub-account must be the same type as its parent' });
        }
      }

      const [account] = await db('accounts')
        .insert({
          code: code.trim(),
          name: name.trim(),
          type: normalized,
          account_class: normalizedClass,
          normal_balance: requestedNormalBalance ?? null,
          parent_id: parent_id || null,
          is_active: true,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning('*') as AccountRow[];

      res.status(201).json({ account: account as AccountSummary });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, AccountResponse | ApiErrorResponse, UpdateAccountInput>,
    res: Response<AccountResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { code, name, type, parent_id, is_active } = req.body || {};
      const requestedClass = req.body?.account_class ? String(req.body.account_class).toUpperCase() : undefined;
      const requestedNormalBalance = req.body?.normal_balance !== undefined && req.body?.normal_balance !== null
        ? String(req.body.normal_balance).toUpperCase()
        : req.body?.normal_balance === null
          ? null
          : undefined;

      const account = await db('accounts').where({ id }).first() as AccountRow | undefined;
      if (!account) return res.status(404).json({ error: 'Account not found' });

      const nextType = (type?.toUpperCase() || account.type) as AccountType;
      if (!VALID_TYPES.includes(nextType)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
      }

      if (requestedClass !== undefined && !VALID_ACCOUNT_CLASSES.includes(requestedClass as AccountClass)) {
        return res.status(400).json({
          error: `Invalid account_class. Must be one of: ${VALID_ACCOUNT_CLASSES.join(', ')}`,
        });
      }
      if (
        requestedNormalBalance !== undefined &&
        requestedNormalBalance !== null &&
        !VALID_NORMAL_BALANCES.includes(requestedNormalBalance as NormalBalanceSide)
      ) {
        return res.status(400).json({
          error: `Invalid normal_balance. Must be one of: ${VALID_NORMAL_BALANCES.join(', ')}`,
        });
      }

      if (type && String(type).toUpperCase() !== account.type) {
        const counted = await db('journal_entries')
          .where({ account_id: id })
          .count('id as count')
          .first() as { count: string } | undefined;

        if (parseInt(counted?.count || '0', 10) > 0) {
          return res.status(409).json({
            error: 'Cannot change account type — this account has transaction history.',
          });
        }
      }

      if (code && code.trim() !== account.code) {
        const duplicate = await db('accounts')
          .where({ code: code.trim() })
          .whereNot({ id })
          .first() as AccountRow | undefined;

        if (duplicate) {
          return res.status(409).json({ error: `Account code ${code} already exists` });
        }
      }

      const [updated] = await db('accounts')
        .where({ id })
        .update({
          code: code?.trim() || account.code,
          name: name?.trim() || account.name,
          type: nextType,
          account_class: requestedClass !== undefined
            ? requestedClass
            : account.account_class || inferDefaultAccountClass(nextType),
          normal_balance: requestedNormalBalance !== undefined ? requestedNormalBalance : account.normal_balance,
          parent_id: parent_id !== undefined ? parent_id || null : account.parent_id,
          is_active: is_active !== undefined ? is_active : account.is_active,
          updated_at: db.fn.now(),
        })
        .returning('*') as AccountRow[];

      res.json({ account: updated as AccountSummary });
    } catch (err) {
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

      const account = await db('accounts').where({ id }).first() as AccountRow | undefined;
      if (!account) return res.status(404).json({ error: 'Account not found' });

      const counted = await db('journal_entries')
        .where({ account_id: id })
        .count('id as count')
        .first() as { count: string } | undefined;

      if (parseInt(counted?.count || '0', 10) > 0) {
        return res.status(409).json({
          error: 'Cannot delete account — it has transaction history. Deactivate it instead.',
        });
      }

      const linkedFund = await db('funds')
        .where({ net_asset_account_id: id, is_active: true })
        .first() as { name: string } | undefined;

      if (linkedFund) {
        return res.status(409).json({
          error: `Cannot delete — this is the Net Asset account for the active fund "${linkedFund.name}".`,
        });
      }

      await db('accounts')
        .where({ id })
        .update({ is_active: false, updated_at: db.fn.now() });

      res.json({ message: 'Account deactivated successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
