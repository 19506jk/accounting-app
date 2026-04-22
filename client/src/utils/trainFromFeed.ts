import Decimal from 'decimal.js'

import type {
  BankMatchingRuleDraft,
  BankMatchingRuleSplitDraft,
  BankTransaction,
  TransactionSplit,
} from '@shared/contracts'

const dec = (value: Decimal.Value | null | undefined) => new Decimal(value ?? 0)

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
])

export interface TrainFromFeedRowInput {
  type: 'deposit' | 'withdrawal'
  offset_account_id?: number
  payee_id?: number
  contact_id?: number
  splits?: TransactionSplit[]
}

export interface TrainFromFeedDraftResult {
  draft: BankMatchingRuleDraft | null
  pattern: string
  error: string | null
}

function normalizeDescription(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractTrainPattern(input: Pick<BankTransaction, 'raw_description' | 'sender_name' | 'bank_description_2'>) {
  const senderName = String(input.sender_name || '').trim()
  const raw = String(input.raw_description || '')
  const desc2 = String(input.bank_description_2 || '')
  const combined = `${raw} ${desc2}`.trim()
  const isEtransfer = /(e[\s-]?transfer|autodeposit|interac)/i.test(combined)
  if (isEtransfer && senderName) {
    return normalizeDescription(senderName)
  }

  const normalized = normalizeDescription(raw)
  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length === 0) return ''

  let best: string[] = []
  let current: string[] = []

  tokens.forEach((token) => {
    if (NOISE_TOKENS.has(token)) {
      if (current.length > best.length) best = [...current]
      current = []
      return
    }
    current.push(token)
  })

  if (current.length > best.length) best = [...current]
  const merchantTokens = best.length > 0 ? best : tokens.filter((token) => !NOISE_TOKENS.has(token))
  return merchantTokens.join(' ').trim()
}

function convertSplitsToRuleDraft(splits: TransactionSplit[], transactionType: 'deposit' | 'withdrawal'): {
  splits: BankMatchingRuleSplitDraft[]
  error: string | null
} {
  const total = splits.reduce((sum, split) => sum.plus(dec(split.amount)), dec(0)).toDecimalPlaces(2)
  if (total.lte(0)) {
    return {
      splits: [],
      error: 'Split amounts must total greater than 0 to preview training.',
    }
  }

  const rows: BankMatchingRuleSplitDraft[] = []
  let running = dec(0)

  for (let index = 0; index < splits.length; index += 1) {
    const split = splits[index]
    if (!split) continue
    if (!split.fund_id) {
      return {
        splits: [],
        error: 'Each split must include a fund to preview training.',
      }
    }
    if (transactionType === 'deposit' && !split.offset_account_id) {
      return {
        splits: [],
        error: 'Each deposit split must include an offset account to preview training.',
      }
    }
    if (transactionType === 'withdrawal' && !split.expense_account_id) {
      return {
        splits: [],
        error: 'Each withdrawal split must include an expense account to preview training.',
      }
    }

    const isLast = index === splits.length - 1
    const pct = isLast
      ? dec(100).minus(running).toDecimalPlaces(4)
      : dec(split.amount).div(total).times(100).toDecimalPlaces(4)
    if (!isLast) running = running.plus(pct)

    rows.push({
      percentage: Number(pct.toFixed(4)),
      fund_id: split.fund_id,
      offset_account_id: split.offset_account_id,
      expense_account_id: split.expense_account_id,
      contact_id: split.contact_id ?? null,
      tax_rate_id: split.tax_rate_id ?? null,
      memo: split.memo ?? null,
      description: split.description ?? null,
    })
  }

  return { splits: rows, error: null }
}

export function buildTrainFromFeedDraft(
  bankTransaction: Pick<BankTransaction, 'account_id' | 'raw_description' | 'sender_name' | 'bank_description_2'>,
  row: TrainFromFeedRowInput,
): TrainFromFeedDraftResult {
  const pattern = extractTrainPattern(bankTransaction)
  if (!pattern) {
    return {
      draft: null,
      pattern: '',
      error: 'No merchant pattern could be extracted from this transaction.',
    }
  }

  const base: Omit<BankMatchingRuleDraft, 'offset_account_id' | 'contact_id' | 'payee_id' | 'splits'> = {
    name: `Auto rule: ${pattern}`,
    priority: 100,
    transaction_type: row.type,
    match_type: 'contains',
    match_pattern: pattern,
    bank_account_id: bankTransaction.account_id,
    is_active: true,
  }

  const hasSplits = Array.isArray(row.splits) && row.splits.length > 0
  if (hasSplits) {
    const splitResult = convertSplitsToRuleDraft(row.splits || [], row.type)
    if (splitResult.error) {
      return { draft: null, pattern, error: splitResult.error }
    }

    return {
      draft: {
        ...base,
        payee_id: row.type === 'withdrawal' ? row.payee_id : undefined,
        contact_id: row.type === 'deposit' ? row.contact_id : undefined,
        splits: splitResult.splits,
      },
      pattern,
      error: null,
    }
  }

  if (row.type === 'deposit') {
    if (!row.offset_account_id) {
      return {
        draft: null,
        pattern,
        error: 'Offset account is required to preview training.',
      }
    }

    return {
      draft: {
        ...base,
        offset_account_id: row.offset_account_id,
        contact_id: row.contact_id,
      },
      pattern,
      error: null,
    }
  }

  if (!row.offset_account_id) {
    return {
      draft: null,
      pattern,
      error: 'Offset account is required to preview training.',
    }
  }
  if (!row.payee_id) {
    return {
      draft: null,
      pattern,
      error: 'Payee is required to preview training for withdrawals.',
    }
  }

  return {
    draft: {
      ...base,
      offset_account_id: row.offset_account_id,
      payee_id: row.payee_id,
    },
    pattern,
    error: null,
  }
}
