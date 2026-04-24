import type { Knex } from 'knex';

import type { AuditAction, AuditEntityType } from '../types/db';

export interface AuditActor {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface ForensicContext {
  sessionToken: string | undefined;
  actor: AuditActor;
  reasonNote?: string;
}

export interface ForensicEventParams {
  entity_type: AuditEntityType;
  entity_id: string | number;
  entity_label?: string | null;
  action: AuditAction;
  payload?: {
    old?: Record<string, unknown>;
    new?: Record<string, unknown>;
    fields_changed?: Record<string, { from: unknown; to: unknown }>;
  } | null;
  reason_note?: string | null;
}

/**
 * Compute a structured diff with only changed fields.
 */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  exclude = new Set(['updated_at', 'created_at']),
): {
  old: Record<string, unknown>;
  new: Record<string, unknown>;
  fields_changed: Record<string, { from: unknown; to: unknown }>;
} {
  const fields_changed: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (exclude.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      fields_changed[key] = { from: before[key], to: after[key] };
    }
  }

  const changedKeys = Object.keys(fields_changed);
  return {
    old: Object.fromEntries(changedKeys.map((k) => [k, before[k]])),
    new: Object.fromEntries(changedKeys.map((k) => [k, after[k]])),
    fields_changed,
  };
}

/**
 * Write one forensic entry inside the same transaction as the domain change.
 */
export async function writeForensicEntry(
  trx: Knex.Transaction,
  ctx: ForensicContext,
  params: ForensicEventParams,
): Promise<void> {
  await trx('audit_log').insert({
    session_token: ctx.sessionToken ?? null,
    entity_type: params.entity_type,
    entity_id: String(params.entity_id),
    entity_label: params.entity_label ?? null,
    action: params.action,
    payload: params.payload ? JSON.stringify(params.payload) : null,
    reason_note: params.reason_note ?? ctx.reasonNote ?? null,
    actor_id: ctx.actor.id,
    actor_name: ctx.actor.name || ctx.actor.email,
    actor_email: ctx.actor.email,
    actor_role: ctx.actor.role,
  });
}
