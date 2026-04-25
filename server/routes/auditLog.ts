import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');

import type {
  AccessLogEntry,
  AccessLogQuery,
  AccessLogResponse,
  ApiErrorResponse,
  AuditAction,
  AuditEntityType,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogResponse,
} from '@shared/contracts';
import { isValidDateOnly } from '../utils/date.js';

const db = require('../db') as Knex;
const auth = require('../middleware/auth.js');
const requireRole = require('../middleware/roles.js');

const router = express.Router();
router.use(auth);
router.use(requireRole('admin'));

const VALID_AUDIT_ACTIONS: AuditAction[] = [
  'create',
  'update',
  'delete',
  'void',
  'close',
  'reopen',
  'pay',
  'apply_credit',
  'unapply_credit',
];

const VALID_AUDIT_ENTITY_TYPES: AuditEntityType[] = [
  'transaction',
  'bill',
  'account',
  'fund',
  'contact',
  'tax_rate',
  'reconciliation',
  'fiscal_period',
  'user',
  'settings',
  'bank_matching_rule',
];

const VALID_ACCESS_OUTCOMES: AccessLogEntry['outcome'][] = ['success', 'unauthorized', 'error', 'pending'];

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'undefined') return null;
  const parsed = parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseLimitOffset(
  limitRaw: unknown,
  offsetRaw: unknown,
  defaultLimit = 50,
  maxLimit = 200
): { limit: number; offset: number } | { error: string } {
  const parsedLimit = parseInt(String(limitRaw ?? defaultLimit), 10);
  const parsedOffset = parseInt(String(offsetRaw ?? 0), 10);

  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return { error: 'limit must be a positive integer' };
  }
  if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
    return { error: 'offset must be a non-negative integer' };
  }

  return { limit: Math.min(parsedLimit, maxLimit), offset: parsedOffset };
}

function validateDateRange(from?: string, to?: string): string | null {
  if (from && !isValidDateOnly(from)) return 'from is not a valid date (YYYY-MM-DD)';
  if (to && !isValidDateOnly(to)) return 'to is not a valid date (YYYY-MM-DD)';
  if (from && to && from > to) return 'from must be before or equal to to';
  return null;
}

function applyAccessFilters(
  query: Knex.QueryBuilder,
  filters: Pick<AccessLogQuery, 'actor_id' | 'from' | 'to' | 'outcome' | 'method'> & { session_token?: string }
) {
  const { actor_id, from, to, outcome, method, session_token } = filters;

  if (actor_id !== undefined) query.where('actor_id', actor_id);
  if (outcome) query.where('outcome', outcome);
  if (method) query.whereRaw('LOWER(request_method) = ?', [method.toLowerCase()]);
  if (session_token) query.where('session_token', session_token);
  if (from) query.whereRaw('created_at::date >= ?', [from]);
  if (to) query.whereRaw('created_at::date <= ?', [to]);

  return query;
}

function applyAuditFilters(
  query: Knex.QueryBuilder,
  filters: Pick<AuditLogQuery, 'actor_id' | 'action' | 'entity_id' | 'entity_type' | 'from' | 'to'> & { session_token?: string }
) {
  const { actor_id, action, entity_id, entity_type, from, to, session_token } = filters;

  if (actor_id !== undefined) query.where('actor_id', actor_id);
  if (action) query.where('action', action);
  if (entity_id) query.where('entity_id', entity_id);
  if (entity_type) query.where('entity_type', entity_type);
  if (session_token) query.where('session_token', session_token);
  if (from) query.whereRaw('created_at::date >= ?', [from]);
  if (to) query.whereRaw('created_at::date <= ?', [to]);

  return query;
}

function normalizeAuditPayload(payload: unknown): AuditLogEntry['payload'] {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as AuditLogEntry['payload'];
    } catch {
      return null;
    }
  }
  return payload as AuditLogEntry['payload'];
}

interface AccessRouteQuery extends Omit<AccessLogQuery, 'actor_id' | 'limit' | 'offset'> {
  actor_id?: string;
  limit?: string;
  method?: string;
  offset?: string;
  session_token?: string;
}

interface AuditRouteQuery extends Omit<AuditLogQuery, 'actor_id' | 'limit' | 'offset'> {
  actor_id?: string;
  limit?: string;
  offset?: string;
  session_token?: string;
}

router.get(
  '/',
  async (
    req: Request<{}, AuditLogResponse | ApiErrorResponse, unknown, AuditRouteQuery>,
    res: Response<AuditLogResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const {
        entity_type,
        entity_id,
        actor_id: actorIdRaw,
        action,
        from,
        to,
        session_token,
        limit,
        offset,
      } = req.query;

      const dateError = validateDateRange(from, to);
      if (dateError) return res.status(400).json({ error: dateError });

      if (entity_type && !VALID_AUDIT_ENTITY_TYPES.includes(entity_type)) {
        return res.status(400).json({ error: `entity_type must be one of: ${VALID_AUDIT_ENTITY_TYPES.join(', ')}` });
      }

      if (action && !VALID_AUDIT_ACTIONS.includes(action)) {
        return res.status(400).json({ error: `action must be one of: ${VALID_AUDIT_ACTIONS.join(', ')}` });
      }

      const actorId = parsePositiveInt(actorIdRaw);
      if (typeof actorIdRaw !== 'undefined' && actorId === null) {
        return res.status(400).json({ error: 'actor_id must be a positive integer' });
      }

      const pagination = parseLimitOffset(limit, offset);
      if ('error' in pagination) {
        return res.status(400).json({ error: pagination.error });
      }

      const baseQuery = applyAuditFilters(db('audit_log'), {
        entity_type,
        entity_id,
        actor_id: actorId ?? undefined,
        action,
        from,
        to,
        session_token,
      });

      const countQuery = baseQuery.clone().count('id as count').first() as Promise<{ count: string } | undefined>;
      const rowsQuery = baseQuery
        .clone()
        .select(
          'id',
          'session_token',
          'entity_type',
          'entity_id',
          'entity_label',
          'action',
          'payload',
          'reason_note',
          'actor_id',
          'actor_name',
          'actor_email',
          'actor_role',
          'created_at'
        )
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(pagination.limit)
        .offset(pagination.offset) as Promise<Array<Omit<AuditLogEntry, 'created_at' | 'payload'> & { created_at: string | Date; payload: unknown }>>;

      const [countRow, rows] = await Promise.all([countQuery, rowsQuery]);

      return res.json({
        audit_logs: rows.map((row) => ({
          ...row,
          payload: normalizeAuditPayload(row.payload),
          created_at: String(row.created_at),
        })),
        total: parseInt(countRow?.count || '0', 10),
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  '/access',
  async (
    req: Request<{}, AccessLogResponse | ApiErrorResponse, unknown, AccessRouteQuery>,
    res: Response<AccessLogResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const {
        actor_id: actorIdRaw,
        outcome,
        method,
        from,
        to,
        session_token,
        limit,
        offset,
      } = req.query;

      const dateError = validateDateRange(from, to);
      if (dateError) return res.status(400).json({ error: dateError });

      if (outcome && !VALID_ACCESS_OUTCOMES.includes(outcome)) {
        return res.status(400).json({ error: `outcome must be one of: ${VALID_ACCESS_OUTCOMES.join(', ')}` });
      }

      const actorId = parsePositiveInt(actorIdRaw);
      if (typeof actorIdRaw !== 'undefined' && actorId === null) {
        return res.status(400).json({ error: 'actor_id must be a positive integer' });
      }

      const pagination = parseLimitOffset(limit, offset);
      if ('error' in pagination) {
        return res.status(400).json({ error: pagination.error });
      }

      const baseQuery = applyAccessFilters(db('access_log'), {
        actor_id: actorId ?? undefined,
        outcome,
        method,
        from,
        to,
        session_token,
      });

      const countQuery = baseQuery.clone().count('id as count').first() as Promise<{ count: string } | undefined>;
      const rowsQuery = baseQuery
        .clone()
        .select(
          'id',
          'session_token',
          'actor_id',
          'actor_email',
          'request_method',
          'request_path',
          'ip_address',
          'user_agent',
          'http_status',
          'outcome',
          'created_at'
        )
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(pagination.limit)
        .offset(pagination.offset) as Promise<Array<Omit<AccessLogEntry, 'created_at'> & { created_at: string | Date }>>;

      const [countRow, rows] = await Promise.all([countQuery, rowsQuery]);

      return res.json({
        access_logs: rows.map((row) => ({
          ...row,
          created_at: String(row.created_at),
        })),
        total: parseInt(countRow?.count || '0', 10),
      });
    } catch (err) {
      return next(err);
    }
  }
);

export = router;
