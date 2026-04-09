import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');

import type {
  CreateFundInput,
  FundSummary,
  NetAssetAccountSummary,
  UpdateFundInput,
} from '@shared/contracts';
import type { AccountRow, FundRow } from '../types/db';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();

router.use(auth);

async function fundBalance(fundId: number | string) {
  const result = await db('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .join('accounts as a', 'a.id', 'je.account_id')
    .where('je.fund_id', fundId)
    .where('a.type', 'EQUITY')
    .where('t.is_voided', false)
    .select(
      db.raw('COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0) AS balance')
    )
    .first() as { balance?: string | number } | undefined;

  return parseFloat(String(result?.balance || 0));
}

router.get('/', async (_req: Request, res: Response<{ funds: FundSummary[] }>, next: NextFunction) => {
  try {
    const funds = await db('funds as f')
      .leftJoin('accounts as a', 'a.id', 'f.net_asset_account_id')
      .select(
        'f.id',
        'f.name',
        'f.description',
        'f.is_active',
        'f.created_at',
        'f.net_asset_account_id',
        'a.code  as net_asset_code',
        'a.name  as net_asset_name'
      )
      .orderBy('f.is_active', 'desc')
      .orderBy('f.name', 'asc');

    res.json({ funds: funds as FundSummary[] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response<{ fund: FundSummary } | { error: string }>, next: NextFunction) => {
  try {
    const fund = await db('funds as f')
      .leftJoin('accounts as a', 'a.id', 'f.net_asset_account_id')
      .where('f.id', req.params.id)
      .select(
        'f.id',
        'f.name',
        'f.description',
        'f.is_active',
        'f.created_at',
        'f.net_asset_account_id',
        'a.code as net_asset_code',
        'a.name as net_asset_name'
      )
      .first() as FundSummary | undefined;

    if (!fund) {
      return res.status(404).json({ error: 'Fund not found' });
    }

    res.json({ fund });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, { fund: FundRow; equityAccount: NetAssetAccountSummary } | { error: string }, CreateFundInput>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { name, description, code } = req.body || {};

      if (!name?.trim()) {
        return res.status(400).json({ error: 'Fund name is required' });
      }

      if (!code?.trim()) {
        return res.status(400).json({ error: 'Fund code is required' });
      }

      const existing = await db('funds').whereRaw('LOWER(name) = LOWER(?)', [name]).first() as FundRow | undefined;
      if (existing) {
        return res.status(409).json({ error: 'A fund with that name already exists' });
      }

      const existingCode = await db('accounts').where({ code: code.trim() }).first() as AccountRow | undefined;
      if (existingCode) {
        return res.status(409).json({ error: 'An account with that code already exists' });
      }

      const result = await db.transaction(async (trx: Knex.Transaction) => {
        const [equityAccount] = await trx('accounts')
          .insert({
            code,
            name: `${name.trim()} - Net Assets`,
            type: 'EQUITY',
            account_class: 'EQUITY',
            is_active: true,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning('*');

        const [fund] = await trx('funds')
          .insert({
            name: name.trim(),
            description: description?.trim() || null,
            net_asset_account_id: equityAccount.id,
            is_active: true,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning('*');

        return { fund, equityAccount };
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  async (req: Request<{ id: string }, { fund: FundRow } | { error: string }, UpdateFundInput>, res: Response, next: NextFunction) => {
    try {
      const { name, description, is_active, code } = req.body || {};
      const { id } = req.params;

      const fund = await db('funds').where({ id }).first() as FundRow | undefined;
      if (!fund) {
        return res.status(404).json({ error: 'Fund not found' });
      }

      if (name) {
        const duplicate = await db('funds')
          .whereRaw('LOWER(name) = LOWER(?)', [name])
          .whereNot({ id })
          .first() as FundRow | undefined;
        if (duplicate) {
          return res.status(409).json({ error: 'A fund with that name already exists' });
        }
      }

      if (code) {
        const duplicateCode = await db('accounts')
          .where({ code: code.trim() })
          .whereNot({ id: fund.net_asset_account_id })
          .first() as AccountRow | undefined;
        if (duplicateCode) {
          return res.status(409).json({ error: 'An account with that code already exists' });
        }
      }

      await db.transaction(async (trx: Knex.Transaction) => {
        const newName = name?.trim() || fund.name;

        await trx('funds')
          .where({ id })
          .update({
            name: newName,
            description: description !== undefined ? description?.trim() || null : fund.description,
            is_active: is_active !== undefined ? is_active : fund.is_active,
            updated_at: trx.fn.now(),
          });

        if (code && fund.net_asset_account_id) {
          await trx('accounts')
            .where({ id: fund.net_asset_account_id })
            .update({
              code: code.trim(),
              updated_at: trx.fn.now(),
            });
        }

        if (name && fund.net_asset_account_id) {
          await trx('accounts')
            .where({ id: fund.net_asset_account_id })
            .update({
              name: `${newName} - Net Assets`,
              updated_at: trx.fn.now(),
            });
        }

        if (is_active !== undefined && fund.net_asset_account_id) {
          await trx('accounts')
            .where({ id: fund.net_asset_account_id })
            .update({
              is_active,
              updated_at: trx.fn.now(),
            });
        }
      });

      const updatedFund = await db('funds').where({ id }).first() as FundRow | undefined;
      if (!updatedFund) {
        return res.status(404).json({ error: 'Fund not found' });
      }
      res.json({ fund: updatedFund });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', requireRole('admin'), async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const fund = await db('funds').where({ id }).first() as FundRow | undefined;
    if (!fund) {
      return res.status(404).json({ error: 'Fund not found' });
    }

    const txCount = await db('transactions')
      .where({ fund_id: id })
      .count('id as count')
      .first() as { count: string } | undefined;

    if (parseInt(txCount?.count || '0', 10) > 0) {
      return res.status(409).json({
        error: 'Fund has transaction history and cannot be deactivated. Set it to inactive manually if needed.',
      });
    }

    const balance = await fundBalance(id);
    if (balance !== 0) {
      return res.status(409).json({
        error: `Fund still carries a balance of $${balance.toFixed(2)}. Zero it out before deactivating.`,
      });
    }

    await db('funds')
      .where({ id })
      .update({ is_active: false, updated_at: db.fn.now() });

    res.json({ message: 'Fund deactivated successfully' });
  } catch (err) {
    next(err);
  }
});

export = router;
