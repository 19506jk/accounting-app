import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
  CreateUserInput,
  Role,
  UpdateUserActiveInput,
  UpdateUserRoleInput,
  UserSummary,
} from '@shared/contracts';
import type { UserRow } from '../types/db';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();

router.use(auth);

const validRoles: Role[] = ['admin', 'editor', 'viewer'];

router.post(
  '/',
  requireRole('admin'),
  async (req: Request<{}, { user: UserSummary } | { error: string }, CreateUserInput>, res: Response, next: NextFunction) => {
    try {
      const { email, role } = req.body || {};

      if (!email || !role) {
        return res.status(400).json({ error: 'email and role are required' });
      }

      if (!validRoles.includes(role)) {
        return res.status(400).json({
          error: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        });
      }

      const existing = await db('users').where({ email }).first() as UserRow | undefined;
      if (existing) {
        return res.status(409).json({ error: 'A user with that email already exists' });
      }

      const [newUser] = await db('users')
        .insert({
          email,
          role,
          google_id: null,
          name: email,
          is_active: true,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning('id', 'name', 'email', 'role', 'is_active', 'created_at');

      res.status(201).json({ user: newUser as UserSummary });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', requireRole('admin'), async (_req: Request, res: Response<{ users: UserSummary[] }>, next: NextFunction) => {
  try {
    const users = await db('users')
      .select('id', 'name', 'email', 'avatar_url', 'role', 'is_active', 'created_at')
      .orderBy('created_at', 'asc');

    res.json({ users: users as UserSummary[] });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/:id/role',
  requireRole('admin'),
  async (req: Request<{ id: string }, { user: UserSummary } | { error: string }, UpdateUserRoleInput>, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { role } = req.body || {};

      if (!role || !validRoles.includes(role)) {
        return res.status(400).json({
          error: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        });
      }

      if (parseInt(id, 10) === req.user?.id) {
        return res.status(400).json({ error: 'You cannot change your own role' });
      }

      const [updated] = await db('users')
        .where({ id })
        .update({ role, updated_at: db.fn.now() })
        .returning('id', 'name', 'email', 'role', 'is_active');

      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ user: updated as UserSummary });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id/active',
  requireRole('admin'),
  async (req: Request<{ id: string }, { user: UserSummary } | { error: string }, UpdateUserActiveInput>, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { is_active } = req.body || {};

      if (typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'is_active must be a boolean' });
      }

      if (parseInt(id, 10) === req.user?.id) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }

      const [updated] = await db('users')
        .where({ id })
        .update({ is_active, updated_at: db.fn.now() })
        .returning('id', 'name', 'email', 'role', 'is_active');

      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ user: updated as UserSummary });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', requireRole('admin'), async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (parseInt(id, 10) === req.user?.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const user = await db('users').where({ id }).first() as UserRow | undefined;
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const txCount = await db('transactions')
      .where({ created_by: id })
      .count('id as count')
      .first() as { count: string } | undefined;

    if (parseInt(txCount?.count || '0', 10) > 0) {
      return res.status(409).json({
        error: 'Cannot delete a user who has recorded transactions. Deactivate them instead.',
      });
    }

    await db('users').where({ id }).delete();

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export = router;
