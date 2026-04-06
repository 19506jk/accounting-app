import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
  ApiErrorResponse,
  MessageResponse,
  SettingsResponse,
  SettingsValues,
  UpdateSettingsInput,
} from '@shared/contracts';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();
router.use(auth);

interface SettingRow {
  id: number;
  key: string;
  value: string | null;
  label: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toValuesMap(rows: SettingRow[]): SettingsValues {
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string | null>;
}

router.get(
  '/',
  async (
    _req: Request,
    res: Response<SettingsResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const rows = await db('settings').orderBy('id', 'asc') as SettingRow[];
      const values = toValuesMap(rows);
      res.json({ settings: rows.map((row) => ({ ...row, created_at: String(row.created_at), updated_at: String(row.updated_at) })), values });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/',
  requireRole('admin'),
  async (
    req: Request<{}, SettingsResponse | ApiErrorResponse | MessageResponse, UpdateSettingsInput>,
    res: Response<SettingsResponse | ApiErrorResponse | MessageResponse>,
    next: NextFunction
  ) => {
    try {
      const updates = req.body;

      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ error: 'Request body must be a key-value object' });
      }

      const existingKeys = await db('settings').select('key') as Array<{ key: string }>;
      const validKeys = new Set(existingKeys.map((row) => row.key));

      const updatePromises = Object.entries(updates)
        .filter(([key]) => validKeys.has(key))
        .map(([key, value]) =>
          db('settings')
            .where({ key })
            .update({ value: value ?? null, updated_at: db.fn.now() })
        );

      await Promise.all(updatePromises);

      const rows = await db('settings').orderBy('id', 'asc') as SettingRow[];
      const values = toValuesMap(rows);
      res.json({ settings: rows.map((row) => ({ ...row, created_at: String(row.created_at), updated_at: String(row.updated_at) })), values });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
