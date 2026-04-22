import type { BillMatchSuggestion, GetBillMatchesInput, GetBillMatchRowInput } from '@shared/contracts'

export interface BillMatchRowWithAccount extends GetBillMatchRowInput {
  account_id: number
}

export function formatCurrency(value: number) {
  return value.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

export function groupBillSuggestions(suggestions: BillMatchSuggestion[] = []) {
  const grouped: Record<number, BillMatchSuggestion[]> = {}
  suggestions.forEach((suggestion) => {
    const existing = grouped[suggestion.row_index] || []
    existing.push(suggestion)
    grouped[suggestion.row_index] = existing
  })
  return grouped
}

export function buildBillMatchRequestGroups(rows: BillMatchRowWithAccount[]): GetBillMatchesInput[] {
  const rowsByAccount = new Map<number, GetBillMatchRowInput[]>()
  rows.forEach(({ account_id, ...row }) => {
    rowsByAccount.set(account_id, [...(rowsByAccount.get(account_id) || []), row])
  })

  return Array.from(rowsByAccount.entries()).map(([bankAccountId, accountRows]) => ({
    bank_account_id: bankAccountId,
    rows: accountRows,
  }))
}
