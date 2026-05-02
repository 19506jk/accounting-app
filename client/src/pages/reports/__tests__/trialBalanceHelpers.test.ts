import { describe, expect, it } from 'vitest'

import type { TrialBalanceReportAccount } from '@shared/contracts'
import { getVisibleTrialBalanceAccounts } from '../trialBalanceHelpers'

function account(overrides: Partial<TrialBalanceReportAccount>): TrialBalanceReportAccount {
  return {
    id: 1,
    code: '1000',
    name: 'Cash',
    type: 'ASSET',
    account_class: 'ASSET',
    normal_balance: 'DEBIT',
    net_side: 'DEBIT',
    net_debit: 0,
    net_credit: 0,
    total_debit: 0,
    total_credit: 0,
    is_abnormal_balance: false,
    is_synthetic: false,
    synthetic_note: null,
    investigate_filters: null,
    ...overrides,
  }
}

describe('getVisibleTrialBalanceAccounts', () => {
  it('orders by account type then code (numeric) and synthetic last for same code', () => {
    const rows = getVisibleTrialBalanceAccounts([
      account({ id: 1, type: 'INCOME', account_class: 'INCOME', code: '4000', name: 'Donations', net_credit: 10 }),
      account({ id: 2, type: 'ASSET', account_class: 'ASSET', code: '1000', name: 'Cash', net_debit: 50 }),
      account({ id: 3, type: 'ASSET', account_class: 'ASSET', code: '1000', name: '[System] Net Income (Prior Years) - General', is_synthetic: true, net_debit: 5 }),
      account({ id: 4, type: 'ASSET', account_class: 'ASSET', code: '200', name: 'Bank', net_debit: 25 }),
    ])

    expect(rows.map((row) => row.id)).toEqual([4, 2, 3, 1])
  })

  it('hides zero balances while preserving zeros with visible synthetic siblings', () => {
    const rows = getVisibleTrialBalanceAccounts([
      account({ id: 10, code: '3000', name: 'Fund Equity', type: 'EQUITY', account_class: 'EQUITY', net_debit: 0, net_credit: 0 }),
      account({
        id: 11,
        code: '3000',
        name: '[System] Net Income (Prior Years) - General Fund',
        type: 'EQUITY',
        account_class: 'EQUITY',
        is_synthetic: true,
        net_debit: 5,
        net_credit: 0,
      }),
      account({
        id: 12,
        code: '3000',
        name: '[System] Net Income (Prior Years) - Building Fund',
        type: 'EQUITY',
        account_class: 'EQUITY',
        is_synthetic: true,
        net_debit: 0,
        net_credit: 0,
      }),
      account({ id: 13, code: '5000', name: 'Expense Zero', type: 'EXPENSE', account_class: 'EXPENSE', net_debit: 0, net_credit: 0 }),
    ], { hideZeroBalances: true })

    expect(rows.map((row) => row.id)).toEqual([10, 11])
  })
})
