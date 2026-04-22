import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  BankMatchingRuleDraft,
  BankRuleConflict,
  BankRuleSimulationMatch,
  BankRuleTransactionType,
  BankStoredCreateProposal,
  SimulateBankMatchingRuleInput,
  SimulateBankMatchingRuleResult,
  TransactionSplit,
} from '@shared/contracts';
import type {
  BankMatchingRuleRow,
  BankMatchingRuleSplitRow,
  BankTransactionRow,
} from '../../types/db';
import { isValidDateOnly } from '../../utils/date.js';
import { normalizeDescription } from './normalize.js';

const dec = (value: Decimal.Value | null | undefined) => new Decimal(value ?? 0);
const MAX_ROUNDING_ADJUSTMENT = dec('0.10');

const SPECIFICITY_ORDER: Record<string, number> = {
  exact: 0,
  contains: 1,
  regex: 2,
};

const NOISE_TOKENS = new Set([
  'purchase',
  'payment',
  'pos',
  'debit',
  'credit',
  'tap',
  'visa',
  'mc',
  'mastercard',
  'interac',
  'etransfer',
  'e',
  'transfer',
  'online',
  'mobile',
  'withdrawal',
  'deposit',
]);

type JoinedBankTransactionRow = BankTransactionRow & {
  account_id: number;
  fund_id: number;
};

type RuleResult =
  | {
    status: 'matched';
    ruleId: number | null;
    ruleName: string;
    transactionType: BankRuleTransactionType;
    matchType: string;
    matchPattern: string;
    proposal: BankStoredCreateProposal;
  }
  | {
    status: 'trust_gate_failed';
    ruleId: number | null;
    ruleName: string;
    transactionType: BankRuleTransactionType;
    matchType: string;
    matchPattern: string;
    reason: string;
  }
  | {
    status: 'no_match';
  };

interface DraftRule {
  id: number | null;
  name: string;
  priority: number;
  transaction_type: BankRuleTransactionType;
  match_type: 'exact' | 'contains' | 'regex';
  match_pattern: string;
  bank_account_id: number | null;
  offset_account_id: number | null;
  payee_id: number | null;
  contact_id: number | null;
  is_active: boolean;
  splits: Array<{
    id: number | null;
    percentage: Decimal;
    fund_id: number;
    offset_account_id: number | null;
    expense_account_id: number | null;
    contact_id: number | null;
    tax_rate_id: number | null;
    memo: string | null;
    description: string | null;
    sort_order: number;
  }>;
}

interface RuleEvaluationContext {
  trx: Knex.Transaction;
  bankTx: JoinedBankTransactionRow;
  txType: BankRuleTransactionType;
  taxRateMap: Map<number, { id: number; rate: Decimal; name: string; recoverable_account_id: number | null }>;
}

function toNumber(value: string | number | null | undefined) {
  return Number.parseFloat(String(value ?? 0));
}

function getTransactionType(amount: string | number): BankRuleTransactionType | null {
  const value = toNumber(amount);
  if (value > 0) return 'deposit';
  if (value < 0) return 'withdrawal';
  return null;
}

function normalizedPattern(matchType: string, matchPattern: string) {
  if (matchType === 'regex') return matchPattern;
  return normalizeDescription(matchPattern);
}

function ruleMatchesBankRow(rule: DraftRule, bankTx: JoinedBankTransactionRow) {
  const normalizedBank = bankTx.normalized_description || normalizeDescription(bankTx.raw_description);
  const pattern = normalizedPattern(rule.match_type, rule.match_pattern);
  if (!pattern) return false;

  if (rule.match_type === 'exact') {
    return normalizedBank === pattern;
  }
  if (rule.match_type === 'contains') {
    return normalizedBank.includes(pattern);
  }

  try {
    const regex = new RegExp(rule.match_pattern, 'i');
    return regex.test(bankTx.raw_description);
  } catch {
    return false;
  }
}

function normalizeRule(
  row: BankMatchingRuleRow,
  splitRows: BankMatchingRuleSplitRow[]
): DraftRule {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    transaction_type: row.transaction_type,
    match_type: row.match_type,
    match_pattern: row.match_pattern,
    bank_account_id: row.bank_account_id,
    offset_account_id: row.offset_account_id,
    payee_id: row.payee_id,
    contact_id: row.contact_id,
    is_active: row.is_active,
    splits: splitRows
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map((split) => ({
        id: split.id,
        percentage: dec(split.percentage),
        fund_id: split.fund_id,
        offset_account_id: split.offset_account_id,
        expense_account_id: split.expense_account_id,
        contact_id: split.contact_id,
        tax_rate_id: split.tax_rate_id,
        memo: split.memo,
        description: split.description,
        sort_order: split.sort_order,
      })),
  };
}

function normalizeDraft(input: BankMatchingRuleDraft): DraftRule {
  return {
    id: null,
    name: String(input.name || '').trim(),
    priority: Number.isInteger(input.priority) ? Number(input.priority) : 100,
    transaction_type: input.transaction_type,
    match_type: input.match_type,
    match_pattern: String(input.match_pattern || '').trim(),
    bank_account_id: input.bank_account_id ?? null,
    offset_account_id: input.offset_account_id ?? null,
    payee_id: input.payee_id ?? null,
    contact_id: input.contact_id ?? null,
    is_active: input.is_active ?? true,
    splits: (input.splits || []).map((split, index) => ({
      id: null,
      percentage: dec(split.percentage),
      fund_id: Number(split.fund_id),
      offset_account_id: split.offset_account_id ?? null,
      expense_account_id: split.expense_account_id ?? null,
      contact_id: split.contact_id ?? null,
      tax_rate_id: split.tax_rate_id ?? null,
      memo: split.memo ?? null,
      description: split.description ?? null,
      sort_order: index,
    })),
  };
}

function floorToCents(value: Decimal) {
  return value.toDecimalPlaces(2, Decimal.ROUND_FLOOR);
}

function allocateByPercent(totalAmount: Decimal, percentages: Decimal[]) {
  const allocations: Decimal[] = [];
  let running = dec(0);
  percentages.forEach((pct, index) => {
    const isLast = index === percentages.length - 1;
    if (isLast) {
      allocations.push(totalAmount.minus(running).toDecimalPlaces(2));
      return;
    }
    const amount = floorToCents(totalAmount.mul(pct).div(100));
    allocations.push(amount);
    running = running.plus(amount);
  });
  return allocations;
}

async function loadTaxRates(
  trx: Knex.Transaction,
  rule: DraftRule
): Promise<Map<number, { id: number; rate: Decimal; name: string; recoverable_account_id: number | null }>> {
  const taxRateIds = Array.from(new Set(
    rule.splits
      .map((split) => split.tax_rate_id)
      .filter((id): id is number => Number.isInteger(Number(id)) && Number(id) > 0)
      .map(Number),
  ));

  if (taxRateIds.length === 0) return new Map();
  const taxRates = await trx('tax_rates')
    .whereIn('id', taxRateIds)
    .where('is_active', true)
    .select('id', 'rate', 'name', 'recoverable_account_id') as Array<{
    id: number;
    rate: string | number;
    name: string;
    recoverable_account_id: number | null;
  }>;

  const map = new Map<number, { id: number; rate: Decimal; name: string; recoverable_account_id: number | null }>();
  taxRates.forEach((row) => {
    map.set(row.id, {
      id: row.id,
      rate: dec(row.rate),
      name: row.name,
      recoverable_account_id: row.recoverable_account_id,
    });
  });
  return map;
}

function buildSingleLineProposal(
  ctx: RuleEvaluationContext,
  rule: DraftRule
): RuleResult {
  if (ctx.txType === 'deposit') {
    if (!rule.offset_account_id) {
      return {
        status: 'trust_gate_failed',
        ruleId: rule.id,
        ruleName: rule.name,
        transactionType: ctx.txType,
        matchType: rule.match_type,
        matchPattern: rule.match_pattern,
        reason: 'deposit_single_line_missing_offset_account',
      };
    }
    return {
      status: 'matched',
      ruleId: rule.id,
      ruleName: rule.name,
      transactionType: ctx.txType,
      matchType: rule.match_type,
      matchPattern: rule.match_pattern,
      proposal: {
        description: ctx.bankTx.raw_description,
        reference_no: ctx.bankTx.bank_transaction_id ?? undefined,
        offset_account_id: rule.offset_account_id,
        contact_id: rule.contact_id ?? undefined,
      },
    };
  }

  if (!rule.offset_account_id || !rule.payee_id) {
    return {
      status: 'trust_gate_failed',
      ruleId: rule.id,
      ruleName: rule.name,
      transactionType: ctx.txType,
      matchType: rule.match_type,
      matchPattern: rule.match_pattern,
      reason: 'withdrawal_single_line_missing_offset_or_payee',
    };
  }
  return {
    status: 'matched',
    ruleId: rule.id,
    ruleName: rule.name,
    transactionType: ctx.txType,
    matchType: rule.match_type,
    matchPattern: rule.match_pattern,
    proposal: {
      description: ctx.bankTx.raw_description,
      reference_no: ctx.bankTx.bank_transaction_id ?? undefined,
      offset_account_id: rule.offset_account_id,
      payee_id: rule.payee_id,
    },
  };
}

function buildSplitProposal(
  ctx: RuleEvaluationContext,
  rule: DraftRule
): RuleResult {
  if (rule.splits.length === 0) {
    return {
      status: 'trust_gate_failed',
      ruleId: rule.id,
      ruleName: rule.name,
      transactionType: ctx.txType,
      matchType: rule.match_type,
      matchPattern: rule.match_pattern,
      reason: 'split_rule_missing_rows',
    };
  }

  const totalPercent = rule.splits.reduce((sum, split) => sum.plus(split.percentage), dec(0));
  if (!totalPercent.equals(dec(100))) {
    return {
      status: 'trust_gate_failed',
      ruleId: rule.id,
      ruleName: rule.name,
      transactionType: ctx.txType,
      matchType: rule.match_type,
      matchPattern: rule.match_pattern,
      reason: 'split_percent_not_100',
    };
  }

  const totalAbsAmount = dec(ctx.bankTx.amount).abs().toDecimalPlaces(2);
  const allocations = allocateByPercent(totalAbsAmount, rule.splits.map((split) => split.percentage));
  const splits: TransactionSplit[] = [];

  for (let index = 0; index < rule.splits.length; index += 1) {
    const template = rule.splits[index];
    const grossAmount = allocations[index]?.toDecimalPlaces(2) ?? dec(0);
    if (!template || grossAmount.lte(0)) {
      return {
        status: 'trust_gate_failed',
        ruleId: rule.id,
        ruleName: rule.name,
        transactionType: ctx.txType,
        matchType: rule.match_type,
        matchPattern: rule.match_pattern,
        reason: 'split_generated_non_positive_amount',
      };
    }

    if (ctx.txType === 'deposit') {
      if (!template.offset_account_id) {
        return {
          status: 'trust_gate_failed',
          ruleId: rule.id,
          ruleName: rule.name,
          transactionType: ctx.txType,
          matchType: rule.match_type,
          matchPattern: rule.match_pattern,
          reason: 'deposit_split_missing_offset_account',
        };
      }
      splits.push({
        amount: Number(grossAmount.toFixed(2)),
        fund_id: template.fund_id,
        offset_account_id: template.offset_account_id,
        contact_id: template.contact_id ?? undefined,
        memo: template.memo ?? undefined,
        description: template.description ?? undefined,
      });
      continue;
    }

    if (!rule.payee_id) {
      return {
        status: 'trust_gate_failed',
        ruleId: rule.id,
        ruleName: rule.name,
        transactionType: ctx.txType,
        matchType: rule.match_type,
        matchPattern: rule.match_pattern,
        reason: 'withdrawal_split_missing_payee',
      };
    }
    if (!template.expense_account_id) {
      return {
        status: 'trust_gate_failed',
        ruleId: rule.id,
        ruleName: rule.name,
        transactionType: ctx.txType,
        matchType: rule.match_type,
        matchPattern: rule.match_pattern,
        reason: 'withdrawal_split_missing_expense_account',
      };
    }

    let preTaxAmount = grossAmount;
    let roundingAdjustment = dec(0);
    if (template.tax_rate_id) {
      const taxRate = ctx.taxRateMap.get(template.tax_rate_id);
      if (!taxRate || !taxRate.recoverable_account_id) {
        return {
          status: 'trust_gate_failed',
          ruleId: rule.id,
          ruleName: rule.name,
          transactionType: ctx.txType,
          matchType: rule.match_type,
          matchPattern: rule.match_pattern,
          reason: 'withdrawal_split_invalid_tax_rate',
        };
      }
      preTaxAmount = floorToCents(grossAmount.div(dec(1).plus(taxRate.rate)));
      const taxAmount = preTaxAmount.mul(taxRate.rate).toDecimalPlaces(2);
      roundingAdjustment = grossAmount.minus(preTaxAmount).minus(taxAmount).toDecimalPlaces(2);
      if (roundingAdjustment.abs().gt(MAX_ROUNDING_ADJUSTMENT)) {
        return {
          status: 'trust_gate_failed',
          ruleId: rule.id,
          ruleName: rule.name,
          transactionType: ctx.txType,
          matchType: rule.match_type,
          matchPattern: rule.match_pattern,
          reason: 'withdrawal_split_rounding_above_limit',
        };
      }
    }

    splits.push({
      amount: Number(grossAmount.toFixed(2)),
      fund_id: template.fund_id,
      expense_account_id: template.expense_account_id,
      tax_rate_id: template.tax_rate_id ?? undefined,
      pre_tax_amount: Number(preTaxAmount.toFixed(2)),
      rounding_adjustment: Number(roundingAdjustment.toFixed(2)),
      description: template.description ?? undefined,
      memo: template.memo ?? undefined,
    });
  }

  return {
    status: 'matched',
    ruleId: rule.id,
    ruleName: rule.name,
    transactionType: ctx.txType,
    matchType: rule.match_type,
    matchPattern: rule.match_pattern,
    proposal: {
      description: ctx.bankTx.raw_description,
      reference_no: ctx.bankTx.bank_transaction_id ?? undefined,
      payee_id: ctx.txType === 'withdrawal' ? rule.payee_id ?? undefined : undefined,
      contact_id: ctx.txType === 'deposit' ? rule.contact_id ?? undefined : undefined,
      splits,
    },
  };
}

async function evaluateRule(
  rule: DraftRule,
  bankTx: JoinedBankTransactionRow,
  trx: Knex.Transaction
): Promise<RuleResult> {
  const txType = getTransactionType(bankTx.amount);
  if (!txType || txType !== rule.transaction_type) {
    return { status: 'no_match' };
  }

  if (rule.bank_account_id && rule.bank_account_id !== bankTx.account_id) {
    return { status: 'no_match' };
  }

  if (!ruleMatchesBankRow(rule, bankTx)) {
    return { status: 'no_match' };
  }

  const taxRateMap = await loadTaxRates(trx, rule);
  const context: RuleEvaluationContext = { trx, bankTx, txType, taxRateMap };
  if (rule.splits.length === 0) {
    return buildSingleLineProposal(context, rule);
  }
  return buildSplitProposal(context, rule);
}

async function loadActiveRulesForType(
  trx: Knex.Transaction,
  txType: BankRuleTransactionType,
  accountId: number
) {
  const rows = await trx('bank_matching_rules')
    .where({ is_active: true, transaction_type: txType })
    .whereNull('deleted_at')
    .where((qb) => qb.whereNull('bank_account_id').orWhere('bank_account_id', accountId))
    .select('*') as BankMatchingRuleRow[];

  if (rows.length === 0) return [] as DraftRule[];
  const splitRows = await trx('bank_matching_rule_splits')
    .whereIn('rule_id', rows.map((row) => row.id))
    .select('*') as BankMatchingRuleSplitRow[];

  const byRule = new Map<number, BankMatchingRuleSplitRow[]>();
  splitRows.forEach((split) => {
    const list = byRule.get(split.rule_id) || [];
    list.push(split);
    byRule.set(split.rule_id, list);
  });

  return rows
    .map((row) => normalizeRule(row, byRule.get(row.id) || []))
    .sort((a, b) => {
      const specA = SPECIFICITY_ORDER[a.match_type] ?? 99;
      const specB = SPECIFICITY_ORDER[b.match_type] ?? 99;
      if (specA !== specB) return specA - specB;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (a.id || 0) - (b.id || 0);
    });
}

export async function evaluateBankTransactionRule(
  bankTransactionId: number,
  trx: Knex.Transaction
): Promise<RuleResult> {
  const bankTx = await trx('bank_transactions as bt')
    .join('bank_uploads as bu', 'bu.id', 'bt.upload_id')
    .where('bt.id', bankTransactionId)
    .select('bt.*', 'bu.account_id', 'bu.fund_id')
    .first() as JoinedBankTransactionRow | undefined;
  if (!bankTx) return { status: 'no_match' };

  const txType = getTransactionType(bankTx.amount);
  if (!txType) return { status: 'no_match' };

  const rules = await loadActiveRulesForType(trx, txType, bankTx.account_id);
  for (const rule of rules) {
    const result = await evaluateRule(rule, bankTx, trx);
    if (result.status === 'no_match') continue;
    return result;
  }

  return { status: 'no_match' };
}

function ensurePositiveInt(value: unknown, field: string, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${field} must be a positive integer`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

export async function validateBankMatchingRuleDraft(
  draft: BankMatchingRuleDraft,
): Promise<void> {
  if (!draft.name || !String(draft.name).trim()) {
    throw new Error('name is required');
  }
  if (!['deposit', 'withdrawal'].includes(String(draft.transaction_type))) {
    throw new Error("transaction_type must be 'deposit' or 'withdrawal'");
  }
  if (!['exact', 'contains', 'regex'].includes(String(draft.match_type))) {
    throw new Error("match_type must be 'exact', 'contains', or 'regex'");
  }
  if (!draft.match_pattern || !String(draft.match_pattern).trim()) {
    throw new Error('match_pattern is required');
  }
  if (draft.match_type === 'regex') {
    try {
      new RegExp(String(draft.match_pattern));
    } catch {
      throw new Error('match_pattern is not a valid regex');
    }
  }

  ensurePositiveInt(draft.bank_account_id, 'bank_account_id', false);
  ensurePositiveInt(draft.offset_account_id, 'offset_account_id', false);
  ensurePositiveInt(draft.payee_id, 'payee_id', false);
  ensurePositiveInt(draft.contact_id, 'contact_id', false);

  const splits = draft.splits || [];
  if (splits.length === 0) return;

  const totalPercent = splits.reduce((sum, split) => sum.plus(dec(split.percentage)), dec(0));
  if (!totalPercent.equals(dec(100))) {
    throw new Error('split percentages must total exactly 100.00');
  }

  splits.forEach((split, index) => {
    const prefix = `splits[${index}]`;
    if (dec(split.percentage).lte(0)) {
      throw new Error(`${prefix}.percentage must be greater than 0`);
    }
    ensurePositiveInt(split.fund_id, `${prefix}.fund_id`);
    ensurePositiveInt(split.offset_account_id, `${prefix}.offset_account_id`, false);
    ensurePositiveInt(split.expense_account_id, `${prefix}.expense_account_id`, false);
    ensurePositiveInt(split.contact_id, `${prefix}.contact_id`, false);
    ensurePositiveInt(split.tax_rate_id, `${prefix}.tax_rate_id`, false);

    if (draft.transaction_type === 'deposit' && !split.offset_account_id) {
      throw new Error(`${prefix}.offset_account_id is required for deposit rules`);
    }
    if (draft.transaction_type === 'withdrawal' && !split.expense_account_id) {
      throw new Error(`${prefix}.expense_account_id is required for withdrawal rules`);
    }
  });
}

export async function simulateBankMatchingRule(
  input: SimulateBankMatchingRuleInput,
  trx: Knex.Transaction
): Promise<SimulateBankMatchingRuleResult> {
  const draftRule = normalizeDraft(input.rule);
  const limit = Math.max(1, Math.min(50, Number(input.filters?.limit || 5)));
  const query = trx('bank_transactions as bt')
    .join('bank_uploads as bu', 'bu.id', 'bt.upload_id')
    .select('bt.*', 'bu.account_id', 'bu.fund_id')
    .orderBy('bt.imported_at', 'desc')
    .orderBy('bt.id', 'desc')
    .limit(limit);

  if (input.filters?.account_id) query.where('bu.account_id', input.filters.account_id);
  if (input.filters?.from && isValidDateOnly(input.filters.from)) query.where('bt.bank_posted_date', '>=', input.filters.from);
  if (input.filters?.to && isValidDateOnly(input.filters.to)) query.where('bt.bank_posted_date', '<=', input.filters.to);

  const rows = await query as JoinedBankTransactionRow[];
  const matches: BankRuleSimulationMatch[] = [];
  const matchedIds: number[] = [];
  for (const row of rows) {
    const result = await evaluateRule(draftRule, row, trx);
    if (result.status !== 'matched') continue;
    matchedIds.push(row.id);
    matches.push({
      bank_transaction_id: row.id,
      bank_posted_date: String(row.bank_posted_date).slice(0, 10),
      raw_description: row.raw_description,
      amount: toNumber(row.amount),
      create_proposal: result.proposal,
    });
  }

  const conflicts: BankRuleConflict[] = [];
  if (matchedIds.length > 0) {
    const existingRules = await trx('bank_matching_rules')
      .where({ is_active: true, transaction_type: draftRule.transaction_type })
      .whereNull('deleted_at')
      .where((qb) => {
        if (input.exclude_rule_id) qb.whereNot('id', input.exclude_rule_id);
      })
      .select('*') as BankMatchingRuleRow[];
    if (existingRules.length > 0) {
      const existingSplits = await trx('bank_matching_rule_splits')
        .whereIn('rule_id', existingRules.map((rule) => rule.id))
        .select('*') as BankMatchingRuleSplitRow[];
      const byRule = new Map<number, BankMatchingRuleSplitRow[]>();
      existingSplits.forEach((split) => {
        const list = byRule.get(split.rule_id) || [];
        list.push(split);
        byRule.set(split.rule_id, list);
      });

      const normalizedExisting = existingRules.map((row) => normalizeRule(row, byRule.get(row.id) || []));
      for (const rule of normalizedExisting) {
        const sampleHitIds: number[] = [];
        for (const row of rows) {
          if (!matchedIds.includes(row.id)) continue;
          if (!ruleMatchesBankRow(rule, row)) continue;
          sampleHitIds.push(row.id);
        }
        if (sampleHitIds.length === 0) continue;
        conflicts.push({
          rule_id: rule.id || 0,
          rule_name: rule.name,
          priority: rule.priority,
          match_type: rule.match_type,
          match_pattern: rule.match_pattern,
          reason: 'overlapping_active_rule_match',
          sample_bank_transaction_ids: sampleHitIds,
        });
      }
    }
  }

  return { matches, conflicts };
}

export async function upsertBankMatchingRule(
  draft: BankMatchingRuleDraft,
  actorId: number | null,
  trx: Knex.Transaction,
  existingId?: number
) {
  await validateBankMatchingRuleDraft(draft);
  const normalized = normalizeDraft(draft);

  const payload = {
    name: normalized.name,
    priority: normalized.priority,
    transaction_type: normalized.transaction_type,
    match_type: normalized.match_type,
    match_pattern: normalized.match_pattern,
    bank_account_id: normalized.bank_account_id,
    offset_account_id: normalized.offset_account_id,
    payee_id: normalized.payee_id,
    contact_id: normalized.contact_id,
    is_active: normalized.is_active,
    updated_at: trx.fn.now(),
  };

  let ruleId = existingId;
  if (existingId) {
    const updated = await trx('bank_matching_rules')
      .where({ id: existingId })
      .whereNull('deleted_at')
      .update(payload)
      .returning('id') as Array<number | { id: number }>;
    if (updated.length === 0) {
      const err = new Error('Rule not found') as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    const idValue = updated[0];
    ruleId = typeof idValue === 'number' ? idValue : idValue?.id;
  } else {
    const inserted = await trx('bank_matching_rules')
      .insert({
        ...payload,
        created_at: trx.fn.now(),
      })
      .returning('id') as Array<number | { id: number }>;
    const idValue = inserted[0];
    ruleId = typeof idValue === 'number' ? idValue : idValue?.id;
  }
  if (!ruleId) throw new Error('Failed to persist rule');

  await trx('bank_matching_rule_splits').where({ rule_id: ruleId }).delete();
  if (normalized.splits.length > 0) {
    await trx('bank_matching_rule_splits').insert(
      normalized.splits.map((split, index) => ({
        rule_id: ruleId,
        percentage: split.percentage.toFixed(4),
        fund_id: split.fund_id,
        offset_account_id: split.offset_account_id,
        expense_account_id: split.expense_account_id,
        contact_id: split.contact_id,
        tax_rate_id: split.tax_rate_id,
        memo: split.memo,
        description: split.description,
        sort_order: index,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })),
    );
  }

  await trx('bank_transaction_events').insert({
    bank_transaction_id: null,
    event_type: existingId ? 'bank_rule_updated' : 'bank_rule_created',
    actor_type: 'user',
    actor_id: actorId,
    payload: JSON.stringify({
      rule_id: ruleId,
      rule_name: normalized.name,
    }),
    created_at: trx.fn.now(),
  });

  return ruleId;
}

export async function listBankMatchingRules(trx: Knex | Knex.Transaction, includeInactive = true) {
  const query = trx('bank_matching_rules')
    .whereNull('deleted_at')
    .orderBy('priority', 'asc')
    .orderBy('id', 'asc');
  if (!includeInactive) query.where({ is_active: true });

  const rules = await query.select('*') as BankMatchingRuleRow[];
  if (rules.length === 0) return [];
  const splits = await trx('bank_matching_rule_splits')
    .whereIn('rule_id', rules.map((rule) => rule.id))
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .select('*') as BankMatchingRuleSplitRow[];
  const byRule = new Map<number, BankMatchingRuleSplitRow[]>();
  splits.forEach((split) => {
    const list = byRule.get(split.rule_id) || [];
    list.push(split);
    byRule.set(split.rule_id, list);
  });

  return rules.map((rule) => {
    const splitRows = (byRule.get(rule.id) || []).map((split) => ({
      id: split.id,
      rule_id: split.rule_id,
      percentage: toNumber(split.percentage),
      fund_id: split.fund_id,
      offset_account_id: split.offset_account_id ?? undefined,
      expense_account_id: split.expense_account_id ?? undefined,
      contact_id: split.contact_id,
      tax_rate_id: split.tax_rate_id,
      memo: split.memo,
      description: split.description,
      created_at: String(split.created_at),
      updated_at: String(split.updated_at),
    }));

    return {
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      transaction_type: rule.transaction_type,
      match_type: rule.match_type,
      match_pattern: rule.match_pattern,
      bank_account_id: rule.bank_account_id,
      offset_account_id: rule.offset_account_id,
      payee_id: rule.payee_id,
      contact_id: rule.contact_id,
      is_active: rule.is_active,
      deleted_at: rule.deleted_at ? String(rule.deleted_at) : null,
      created_at: String(rule.created_at),
      updated_at: String(rule.updated_at),
      splits: splitRows,
    };
  });
}

export async function softDeleteBankMatchingRule(
  ruleId: number,
  actorId: number | null,
  trx: Knex.Transaction
) {
  const updated = await trx('bank_matching_rules')
    .where({ id: ruleId })
    .whereNull('deleted_at')
    .update({
      deleted_at: trx.fn.now(),
      is_active: false,
      updated_at: trx.fn.now(),
    })
    .returning(['id', 'name']) as Array<{ id: number; name: string }>;
  if (updated.length === 0) {
    const err = new Error('Rule not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  await trx('bank_transaction_events').insert({
    bank_transaction_id: null,
    event_type: 'bank_rule_deleted',
    actor_type: 'user',
    actor_id: actorId,
    payload: JSON.stringify({
      rule_id: updated[0]?.id,
      rule_name: updated[0]?.name,
    }),
    created_at: trx.fn.now(),
  });
}

export function extractTrainFromFeedPattern(input: {
  raw_description: string;
  sender_name?: string | null;
  bank_description_2?: string | null;
}) {
  const senderName = String(input.sender_name || '').trim();
  const raw = String(input.raw_description || '');
  const desc2 = String(input.bank_description_2 || '');
  const combined = `${raw} ${desc2}`.trim();
  const isEtransfer = /(e[\s-]?transfer|autodeposit|interac)/i.test(combined);
  if (isEtransfer && senderName) {
    return normalizeDescription(senderName);
  }

  const normalized = normalizeDescription(raw);
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return '';

  let best: string[] = [];
  let current: string[] = [];
  tokens.forEach((token) => {
    if (NOISE_TOKENS.has(token)) {
      if (current.length > best.length) best = [...current];
      current = [];
      return;
    }
    current.push(token);
  });
  if (current.length > best.length) best = [...current];
  const merchantTokens = best.length > 0 ? best : tokens.filter((token) => !NOISE_TOKENS.has(token));
  return merchantTokens.join(' ').trim();
}
