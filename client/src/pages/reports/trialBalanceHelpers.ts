import type { AccountType, TrialBalanceReportAccount } from '@shared/contracts';

const SYNTHETIC_FUND_LABEL_PATTERN = /^\[System\] Net Income \(Prior Years\) - (.+)$/i
const TRIAL_BALANCE_TYPE_ORDER: Record<AccountType, number> = {
  ASSET: 1,
  LIABILITY: 2,
  EQUITY: 3,
  INCOME: 4,
  EXPENSE: 5,
}

function isNonZeroTrialBalanceAccount(account: TrialBalanceReportAccount) {
  return Number(account?.net_debit || 0) !== 0 || Number(account?.net_credit || 0) !== 0
}

function syntheticFundSortKey(account: TrialBalanceReportAccount) {
  const match = String(account?.name || '').match(SYNTHETIC_FUND_LABEL_PATTERN)
  if (match?.[1]) return match[1].trim().toLowerCase()
  return String(account?.name || '').trim().toLowerCase()
}

function sortTrialBalanceAccounts(accounts: TrialBalanceReportAccount[] = []) {
  return (accounts || [])
    .map((account, index) => ({ account, index }))
    .sort((a, b) => {
      const typeA = TRIAL_BALANCE_TYPE_ORDER[a.account.type]
      const typeB = TRIAL_BALANCE_TYPE_ORDER[b.account.type]
      if (typeA !== typeB) return typeA - typeB

      const byCode = String(a.account?.code || '').localeCompare(String(b.account?.code || ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
      if (byCode !== 0) return byCode

      const syntheticA = Boolean(a.account?.is_synthetic)
      const syntheticB = Boolean(b.account?.is_synthetic)
      if (syntheticA !== syntheticB) return syntheticA ? 1 : -1

      if (syntheticA && syntheticB) {
        const byFund = syntheticFundSortKey(a.account).localeCompare(syntheticFundSortKey(b.account))
        if (byFund !== 0) return byFund
      }

      const byName = String(a.account?.name || '').localeCompare(String(b.account?.name || ''))
      if (byName !== 0) return byName
      return a.index - b.index
    })
    .map(({ account }) => account)
}

export function getVisibleTrialBalanceAccounts(accounts: TrialBalanceReportAccount[] = [], { hideZeroBalances = false }: { hideZeroBalances?: boolean } = {}) {
  const ordered = sortTrialBalanceAccounts(accounts)
  if (!hideZeroBalances) return ordered

  const visibleSyntheticByCode = new Map()
  ordered.forEach((account) => {
    if (!account?.is_synthetic) return
    if (!isNonZeroTrialBalanceAccount(account)) return
    const code = String(account?.code || '')
    visibleSyntheticByCode.set(code, (visibleSyntheticByCode.get(code) || 0) + 1)
  })

  return ordered.filter((account) => {
    if (account?.is_synthetic) return isNonZeroTrialBalanceAccount(account)
    if (isNonZeroTrialBalanceAccount(account)) return true
    const code = String(account?.code || '')
    return (visibleSyntheticByCode.get(code) || 0) > 0
  })
}
